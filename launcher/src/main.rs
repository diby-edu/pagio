//! Pagio-Admin : lanceur de bureau.
//! Double-clic : démarre le serveur Pagio (Node.js) et ouvre le tableau de bord dans le navigateur.
//! `Pagio-Admin.exe --screenshot capture.png` : serveur temporaire, capture de l'écran de connexion, arrêt.
//! L'exécutable se place dans le dossier `app/` (à côté de `server/` et `dist/`).

use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread::sleep;
use std::time::{Duration, Instant};

fn app_dir() -> PathBuf {
    let exe = env::current_exe().expect("chemin du programme");
    let mut dir = exe.parent().unwrap().to_path_buf();
    // Fonctionne aussi depuis launcher/target/release pendant le développement.
    for _ in 0..4 {
        if dir.join("server").join("src").join("server.js").exists() { return dir; }
        if !dir.pop() { break; }
    }
    exe.parent().unwrap().to_path_buf()
}

fn which(cmd: &str) -> Option<PathBuf> {
    let exts = if cfg!(windows) { vec![".exe", ".cmd", ""] } else { vec![""] };
    env::var_os("PATH").and_then(|paths| {
        env::split_paths(&paths).find_map(|d| exts.iter().map(|e| d.join(format!("{cmd}{e}"))).find(|p| p.is_file()))
    })
}

fn free_port(preferred: u16) -> u16 {
    if TcpListener::bind(("127.0.0.1", preferred)).is_ok() { return preferred; }
    TcpListener::bind(("127.0.0.1", 0)).map(|l| l.local_addr().unwrap().port()).unwrap_or(preferred)
}

fn npm(dir: &Path, args: &[&str]) {
    let npm = which("npm").unwrap_or_else(|| fail("npm introuvable : installez Node.js 22.13 ou plus récent (https://nodejs.org)."));
    let status = if cfg!(windows) {
        Command::new("cmd").arg("/C").arg(npm).args(args).current_dir(dir).status()
    } else {
        Command::new(npm).args(args).current_dir(dir).status()
    };
    if !matches!(status, Ok(s) if s.success()) { fail(&format!("échec de « npm {} »", args.join(" "))); }
}

fn prepare(app: &Path) {
    if !app.join("server").join("node_modules").exists() {
        println!("Installation des dépendances du serveur…");
        npm(&app.join("server"), &["install", "--no-audit", "--no-fund"]);
    }
    if !app.join("dist").join("index.html").exists() {
        println!("Construction du tableau de bord…");
        npm(app, &["install", "--no-audit", "--no-fund"]);
        npm(app, &["run", "build"]);
    }
}

fn start_server(app: &Path, port: u16, data: &Path, extra: &[(&str, &str)]) -> Child {
    let node = which("node").unwrap_or_else(|| fail("Node.js introuvable : installez Node.js 22.13 ou plus récent (https://nodejs.org)."));
    let mut cmd = Command::new(node);
    cmd.args(["--disable-warning=ExperimentalWarning", "src/server.js"])
        .current_dir(app.join("server"))
        .env("PORT", port.to_string())
        .env("DATA_DIR", data)
        .env("DIST_DIR", app.join("dist"));
    for (k, v) in extra { cmd.env(k, v); }
    cmd.spawn().unwrap_or_else(|e| fail(&format!("démarrage du serveur impossible : {e}")))
}

fn wait_ready(port: u16) -> bool {
    let end = Instant::now() + Duration::from_secs(40);
    while Instant::now() < end {
        if let Ok(mut s) = TcpStream::connect(("127.0.0.1", port)) {
            let _ = s.write_all(b"GET /api/health HTTP/1.0\r\nHost: localhost\r\n\r\n");
            let mut buf = String::new();
            let _ = s.read_to_string(&mut buf);
            if buf.starts_with("HTTP/1.1 200") || buf.starts_with("HTTP/1.0 200") { return true; }
        }
        sleep(Duration::from_millis(400));
    }
    false
}

fn browser() -> Option<PathBuf> {
    [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    ].iter().map(PathBuf::from).find(|p| p.is_file())
        .or_else(|| ["google-chrome", "chromium", "chromium-browser", "msedge"].iter().find_map(|c| which(c)))
}

fn fail(msg: &str) -> ! { eprintln!("Erreur : {msg}"); std::process::exit(1) }

fn screenshot(app: &Path, target: &str) {
    prepare(app);
    let port = free_port(8799);
    let data = env::temp_dir().join(format!("pagio-shot-{}", std::process::id()));
    let mut server = start_server(app, port, &data, &[("ADMIN_EMAIL", "recette@pagio.local"), ("ADMIN_PASSWORD", "Recette-capture-2026")]);
    let ok = wait_ready(port);
    let target = env::current_dir().unwrap().join(target);
    if let Some(dir) = target.parent() { let _ = fs::create_dir_all(dir); }
    let result = if ok {
        match browser() {
            Some(b) => {
                let profile = env::temp_dir().join(format!("pagio-browser-{}", std::process::id()));
                let status = Command::new(b)
                    .args(["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1440,900", "--virtual-time-budget=4000"])
                    .arg(format!("--user-data-dir={}", profile.display()))
                    .arg(format!("--screenshot={}", target.display()))
                    .arg(format!("http://127.0.0.1:{port}/"))
                    .stdout(Stdio::null()).stderr(Stdio::null()).status();
                let _ = fs::remove_dir_all(&profile);
                matches!(status, Ok(_)) && target.is_file()
            }
            None => { eprintln!("Aucun navigateur Edge/Chrome trouvé pour la capture."); false }
        }
    } else { eprintln!("Le serveur n'a pas démarré."); false };
    let _ = server.kill();
    let _ = server.wait();
    let _ = fs::remove_dir_all(&data);
    if !result { std::process::exit(1); }
    println!("Capture enregistrée : {}", target.display());
}

fn run(app: &Path) {
    prepare(app);
    let port = free_port(8787);
    let mut server = start_server(app, port, &app.join("server").join("data"), &[]);
    if !wait_ready(port) { let _ = server.kill(); fail("le serveur Pagio n'a pas démarré"); }
    let url = format!("http://localhost:{port}/");
    println!("\nTableau de bord Pagio : {url}");
    println!("Identifiants du premier démarrage : voir ci-dessus ou server\\data\\premier-admin.txt");
    println!("Laissez cette fenêtre ouverte ; fermez-la pour arrêter le serveur.\n");
    let _ = if cfg!(windows) { Command::new("cmd").args(["/C", "start", "", &url]).status() }
        else if cfg!(target_os = "macos") { Command::new("open").arg(&url).status() }
        else { Command::new("xdg-open").arg(&url).status() };
    let _ = server.wait();
}

fn main() {
    let app = app_dir();
    let args: Vec<String> = env::args().collect();
    if args.len() >= 3 && args[1] == "--screenshot" { screenshot(&app, &args[2]); } else { run(&app); }
}
