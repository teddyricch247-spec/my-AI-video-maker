#!/usr/bin/env python3
"""Preflight: checks everything the offline pipeline needs and prints exact fixes. Run first: python3 pipeline/doctor.py"""
import os, shutil, subprocess, sys, tempfile, time
HERE = os.path.dirname(os.path.abspath(__file__)); ok = True
def line(good, name, info, fix=""):
    global ok; ok &= bool(good) or fix == "optional"
    print(("PASS " if good else ("WARN " if fix == "optional" else "FAIL ")) + name + (" - " + info if info else "") + ("" if good or fix in ("", "optional") else "\n     fix: " + fix))
def out(c):
    try: return subprocess.run(c, capture_output=True, text=True, timeout=60).stdout.strip()
    except Exception: return ""
node = shutil.which("node"); line(node, "node", out(["node", "-v"]) if node else "", "install Node 18+")
ff = shutil.which("ffmpeg"); line(ff, "ffmpeg", (out(["ffmpeg", "-version"]).splitlines() or [""])[0] if ff else "", "install ffmpeg")
line(shutil.which("ffprobe"), "ffprobe (used when saving, to tag 16:9 files)", "", "optional")
if ff: line("libx264" in out(["ffmpeg", "-hide_banner", "-encoders"]), "ffmpeg libx264", "", "use an ffmpeg build with libx264")
line(os.path.exists(os.path.join(HERE, "..", "vendor", "three", "three.module.js")), "vendored three.js", "no network needed", "re-copy vendor/ from the skill zip")
if node:
    r = subprocess.run([node, "-e", "try{require('playwright')}catch(e){try{require('playwright-core')}catch(e2){process.exit(1)}}"], capture_output=True)
    glob = out(["npm", "root", "-g"]); has = r.returncode == 0 or (glob and any(os.path.isdir(os.path.join(glob, m)) for m in ("playwright", "playwright-core")))
    line(has or os.path.isdir("/opt/npm-tools/node_modules/playwright"), "playwright module", "", "npm i playwright-core   (run in the skill folder)")
try: import numpy; line(True, "numpy", numpy.__version__)
except ImportError: line(False, "numpy (only for QA scripts)", "", "optional")
if node:
    tmp = tempfile.mkdtemp(); t = time.time()
    r = subprocess.run([node, "render.js", "--scene", "beats_test", "--frames", "0-1", "--out", tmp], capture_output=True, text=True, cwd=HERE, timeout=180)
    n = len([f for f in os.listdir(tmp) if f.endswith(".jpg")])
    line(n == 2 and "FATAL" not in r.stdout, "WebGL2 test render", f"{n} frames in {time.time()-t:.1f}s" if n else "", (r.stdout + r.stderr)[-300:] or "check Chrome path: set CHROME_PATH=/path/to/chrome-headless-shell")
if node:
    tmp = tempfile.mkdtemp(); t = time.time()
    r = subprocess.run([node, "render.js", "--scene", "beats_test", "--frames", "0-1", "--w", "480", "--h", "270", "--out", tmp], capture_output=True, text=True, cwd=HERE, timeout=180)
    n = len([f for f in os.listdir(tmp) if f.endswith(".jpg")])
    line(n == 2 and "FATAL" not in r.stdout, "16:9 test render", f"{n} frames in {time.time()-t:.1f}s" if n else "", (r.stdout + r.stderr)[-300:])
print("\nALL GOOD" if ok else "\nFix the FAIL lines above, then re-run.")
sys.exit(0 if ok else 1)
