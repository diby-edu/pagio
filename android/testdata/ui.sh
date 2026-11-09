#!/usr/bin/env bash
# Utilitaire de test manuel sur émulateur : touche l'élément dont le texte contient $1 (via uiautomator).
#   ./ui.sh "Texte"              touche le premier élément contenant « Texte »
#   ./ui.sh "Texte" long         appui long
#   ./ui.sh "Texte" "" exact     correspondance exacte
#   ./ui.sh "Texte" "" "" last   dernier élément correspondant
export MSYS_NO_PATHCONV=1 PYTHONIOENCODING=utf-8
ADB="$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"
"$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
"$ADB" exec-out cat /sdcard/ui.xml > "$(cygpath -u "$TEMP")/pagio_ui.xml"
LASTM="$4" EXACT="$3" LONG="$2" UIX="$(cygpath -w "$TEMP")\pagio_ui.xml" python -I - "$1" <<'PY'
import re, sys, subprocess, os
x = open(os.environ["UIX"], encoding="utf-8", errors="replace").read()
q = sys.argv[1]
ms = list(re.finditer(r'<node [^>]*?(?:text|content-desc)="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', x))
if os.environ.get("LASTM"):
    ms = ms[::-1]
adb = os.path.expandvars(r"$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe")
for m in ms:
    t = m.group(1)
    hit = (t.lower() == q.lower()) if os.environ.get("EXACT") else (q.lower() in t.lower())
    if hit:
        a, b, c, d = map(int, m.groups()[1:]); cx, cy = (a + c) // 2, (b + d) // 2
        print("tap", t[:40], cx, cy)
        cmd = ["shell", "input", "swipe", str(cx), str(cy), str(cx), str(cy), "900"] if os.environ.get("LONG") else ["shell", "input", "tap", str(cx), str(cy)]
        subprocess.run([adb] + cmd)
        break
else:
    print("NOT FOUND:", q); print(sorted(set(re.findall(r'text="([^"]+)"', x)))[:60])
PY
