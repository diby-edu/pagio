"""Lanceur de bureau Pagio Admin.

Double-cliquez (ou `python main.py`) : démarre le serveur Pagio (Node.js) avec ses données dans server/data,
puis ouvre le tableau de bord d'administration dans le navigateur. Fermez la fenêtre pour arrêter le serveur.

Option de contrôle : `python main.py --screenshot fichier.png` démarre un serveur temporaire de recette,
photographie l'écran de connexion du tableau de bord avec un navigateur sans fenêtre, puis s'arrête.
"""
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(HERE, "server")
DIST = os.path.join(HERE, "dist")


def need(cmd: str) -> str:
    path = shutil.which(cmd)
    if not path:
        sys.exit(f"« {cmd} » est introuvable : installez Node.js 22.13 ou plus récent (https://nodejs.org).")
    return path


def free_port(preferred: int = 8787) -> int:
    for port in (preferred, 0):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return s.getsockname()[1]
            except OSError:
                continue
    return preferred


def prepare() -> None:
    npm = need("npm")
    if not os.path.isdir(os.path.join(SERVER, "node_modules")):
        print("Installation des dépendances du serveur…")
        subprocess.run([npm, "install", "--no-audit", "--no-fund"], cwd=SERVER, check=True, shell=os.name == "nt")
    if not os.path.isfile(os.path.join(DIST, "index.html")):
        print("Construction du tableau de bord…")
        subprocess.run([npm, "install", "--no-audit", "--no-fund"], cwd=HERE, check=True, shell=os.name == "nt")
        subprocess.run([npm, "run", "build"], cwd=HERE, check=True, shell=os.name == "nt")


def start_server(port: int, data_dir: str, extra_env: dict | None = None) -> subprocess.Popen:
    env = dict(os.environ, PORT=str(port), DATA_DIR=data_dir, DIST_DIR=DIST, **(extra_env or {}))
    return subprocess.Popen([need("node"), "--disable-warning=ExperimentalWarning", "src/server.js"], cwd=SERVER, env=env)


def wait_ready(port: int, timeout: float = 30) -> None:
    end = time.time() + timeout
    while time.time() < end:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=2) as r:
                if r.status == 200:
                    return
        except OSError:
            time.sleep(0.4)
    raise RuntimeError("Le serveur Pagio n'a pas démarré à temps.")


def browser() -> str | None:
    for c in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
              r"C:\Program Files\Google\Chrome\Application\chrome.exe", "google-chrome", "chromium", "chromium-browser", "msedge"):
        p = c if os.path.isfile(c) else shutil.which(c)
        if p:
            return p
    return None


def screenshot(target: str) -> None:
    prepare()
    port = free_port(8799)
    data = tempfile.mkdtemp(prefix="pagio-shot-")
    proc = start_server(port, data, {"ADMIN_EMAIL": "recette@pagio.local", "ADMIN_PASSWORD": "Recette-capture-2026"})
    try:
        wait_ready(port)
        exe = browser()
        if not exe:
            sys.exit("Aucun navigateur Chromium/Edge trouvé pour la capture.")
        target = os.path.abspath(target)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        profile = tempfile.mkdtemp(prefix="pagio-browser-")
        subprocess.run([exe, "--headless=new", "--disable-gpu", f"--user-data-dir={profile}", "--hide-scrollbars",
                        "--window-size=1440,900", "--virtual-time-budget=4000", f"--screenshot={target}",
                        f"http://127.0.0.1:{port}/"], timeout=90, check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        shutil.rmtree(profile, ignore_errors=True)
        if not os.path.isfile(target) or os.path.getsize(target) == 0:
            sys.exit("La capture n'a pas pu être enregistrée.")
        print(f"Capture enregistrée : {target}")
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(data, ignore_errors=True)


def run() -> None:
    prepare()
    port = free_port(8787)
    data = os.path.join(SERVER, "data")
    proc = start_server(port, data)
    try:
        wait_ready(port)
        url = f"http://localhost:{port}/"
        print(f"\nTableau de bord Pagio : {url}\nIdentifiants du premier démarrage : voir ci-dessus ou server/data/premier-admin.txt")
        print("Laissez cette fenêtre ouverte ; fermez-la (ou Ctrl+C) pour arrêter le serveur.\n")
        webbrowser.open(url)
        proc.wait()
    except KeyboardInterrupt:
        pass
    finally:
        if proc.poll() is None:
            proc.terminate()


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--screenshot":
        screenshot(sys.argv[2])
    else:
        run()
