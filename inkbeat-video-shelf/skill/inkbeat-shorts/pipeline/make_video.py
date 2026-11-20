#!/usr/bin/env python3
"""One command: word-timestamp transcript -> captions -> frames (three.js, offline) -> mp4 part(s) -> QA. Never uploads anything.

  python3 make_video.py --scene beats_test --transcript words.txt --mode draft --out .renders/short1
  python3 make_video.py --scene my_story --transcript words.txt --aspect 16:9 --mode draft --out .renders/story     # YouTube
  python3 make_video.py --scene street --seconds 7 --mode draft                                                      # no transcript: scene's own words

Aspect:   --aspect 9:16 (default, Shorts, 1-2 word captions)  |  16:9 (YouTube, small full-sentence captions, active word lit).
Modes:    draft = 540x960 / 960x540, no blur (fastest)  |  fast = 720x1280 / 1280x720, 4-sub-frame blur
          |  final = 1080x1920 / 1920x1080, 8-sub-frame blur.   Output is always upscaled/encoded to 1080x1920 or 1920x1080 H.264.
Parts:    a video longer than --part-seconds (default 30) is cut into equal parts of at most that length, each cut snapped to a
          pause between words. The parts are consecutive frames of ONE continuous timeline, so they butt together seamlessly in
          an editor. Output: <out>/video.mp4 (one part) or <out>/part-01.mp4, part-02.mp4, ... plus <out>/parts.json and report.json.
Audio:    no voice-over is ever made (the owner records it). --audio takes an optional SFX/music stem (no voice) covering the
          whole timeline; it is sliced per part. Without it the mp4s are silent.
Saving:   this script only renders. Uploading to the shelf is a separate step, done only when the owner asks (publish.mjs).
Resume:   re-running skips frames already on disk. Frames are stored per aspect+mode and wiped automatically if the scene file,
          the transcript, the render settings or the renderer code (pipeline/lib, objects/) changed (--fresh forces a wipe).
Transcript: one word per line, `0.112 - 0.176  If` (start - end  word). Also accepted: `[0.112 --> 0.176] If`, `0.112 0.176 If`,
          `If,0.112,0.176`, `00:00:01.120 - 00:00:01.480 If`, or a JSON list of {word|text, start, end}. Other lines are ignored.
"""
import argparse, hashlib, json, math, os, re, shutil, subprocess, sys, time, concurrent.futures as cf

HERE = os.path.dirname(os.path.abspath(__file__)); SKILL = os.path.dirname(HERE)
SIZES = {"9:16": {"draft": (540, 960, 1), "fast": (720, 1280, 4), "final": (1080, 1920, 8)},
         "16:9": {"draft": (960, 540, 1), "fast": (1280, 720, 4), "final": (1920, 1080, 8)}}
OUT_SIZE = {"9:16": (1080, 1920), "16:9": (1920, 1080)}
ASPECT_NAMES = {"9:16": "9:16", "9x16": "9:16", "vertical": "9:16", "portrait": "9:16", "short": "9:16", "shorts": "9:16",
                "16:9": "16:9", "16x9": "16:9", "landscape": "16:9", "horizontal": "16:9", "wide": "16:9", "youtube": "16:9",
                "long": "16:9", "longform": "16:9"}
SMALL = {"a", "an", "the", "to", "of", "in", "on", "if", "you", "it", "is", "and", "or", "at", "by", "so", "we", "i", "my", "be"}
ABBR = {"mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "no", "approx"}
SIZE_SHRINK_MB, SIZE_LIMIT_MB = 45, 50   # Supabase free tier rejects >50 MB per file; saving re-encodes anything over 45 MB


# ---------------------------------------------------------------------------------------------- transcript
_T = r"(?:\d+:){0,2}\d+(?:[.,]\d+)?"
_SEP = r"(?:\s*(?:-+>?|–|—|→|to|,|;|:|\|)\s*|\s+)"
RE_A = re.compile(rf"^\W{{0,3}}?({_T}){_SEP}({_T})\s*\]?[\s,;:\t]*(\S.*?)\s*$")   # start - end  word
RE_B = re.compile(rf"^(\S.*?)[,;\t]\s*({_T})\s*[,;\t]\s*({_T})\s*$")                # word,start,end


def _sec(s):
    v = 0.0
    for p in s.replace(",", ".").split(":"): v = v * 60 + float(p)
    return v


def _json_words(data):
    """Flatten the JSON shapes people paste: a list of {word,start,end}, a list of [start,end,word], or {words|segments: ...}."""
    out = []
    if isinstance(data, dict):
        for k in ("words", "word_timestamps", "items", "segments", "results"):
            if k in data: return _json_words(data[k])
        return out
    for it in data if isinstance(data, list) else []:
        if isinstance(it, dict):
            if "words" in it and isinstance(it["words"], list): out += _json_words(it["words"]); continue
            w = next((it[k] for k in ("word", "text", "w", "token") if k in it), None)
            s = next((it[k] for k in ("start", "begin", "s", "from", "t0", "start_time") if k in it), None)
            e = next((it[k] for k in ("end", "stop", "e", "to", "t1", "end_time") if k in it), None)
            if w is not None and s is not None: out.append((float(s), float(e if e is not None else s), str(w).strip()))
        elif isinstance(it, (list, tuple)) and len(it) >= 3:
            a, b, c = it[:3]
            try: out.append((float(a), float(b), str(c).strip()))
            except (TypeError, ValueError):
                try: out.append((float(b), float(c), str(a).strip()))
                except (TypeError, ValueError): pass
    return out


def parse_transcript(path):
    txt = open(path, encoding="utf-8-sig").read(); words = []
    if txt.lstrip()[:1] in "[{":
        try: words = _json_words(json.loads(txt))
        except Exception: words = []
    if not words:
        for ln in txt.splitlines():
            ln = ln.strip()
            m = RE_A.match(ln)
            if m: words.append((_sec(m[1]), _sec(m[2]), m[3].strip().strip("`")))
            else:
                m = RE_B.match(ln)
                if m: words.append((_sec(m[2]), _sec(m[3]), m[1].strip().strip("`")))
    words = [(s, max(e, s + 0.05), w) for s, e, w in words if w]
    if not words: sys.exit("no word timestamps found in %s. Expected lines like `0.112 - 0.176  If` (start - end  word)." % path)
    words.sort(key=lambda x: x[0])
    return words


# ---------------------------------------------------------------------------------------------- captions
def captions(words):
    """9:16 Shorts: 1-2 lowercase words per caption, swapped on the first word's onset; short function words join the next word."""
    out, i = [], 0
    while i < len(words):
        t, _, w = words[i]
        if i + 1 < len(words) and re.sub(r"\W", "", w.lower()) in SMALL and words[i + 1][0] - words[i][1] < 0.35 and not re.search(r"[.!?,]$", w):
            out.append([t, (w + " " + words[i + 1][2]).lower()]); i += 2
        else:
            out.append([t, w.lower()]); i += 1
    return out


def _ends_sentence(w):
    if not re.search(r"[.!?…][\"'”’)\]]*$", w): return False
    core = re.sub(r"[\"'”’)\]]+$", "", w).rstrip(".!?…").lower()
    if w.endswith(".") and (core in ABBR or re.fullmatch(r"[a-z]", core)): return False     # Dr.  e.g.  J.
    return True


def sentences(words, max_words=14, max_chars=84, gap=0.8):
    """16:9 YouTube: whole sentences, original capitalisation. A sentence ends at . ! ? (not Dr. / e.g.), at a pause > gap s,
    or when it gets too long for two small lines (then at the last comma if there is one)."""
    out, cur = [], []

    def flush(k=None):
        nonlocal cur
        part, cur = (cur, []) if k is None else (cur[:k], cur[k:])
        if part: out.append({"t": round(part[0][0], 3), "end": round(part[-1][1], 3), "words": [[round(s, 3), round(e, 3), w] for s, e, w in part]})

    for i, (s, e, w) in enumerate(words):
        cur.append((s, e, w)); nxt = words[i + 1] if i + 1 < len(words) else None
        if _ends_sentence(w) or nxt is None or nxt[0] - e > gap: flush(); continue
        if len(cur) >= max_words or len(" ".join(x[2] for x in cur)) >= max_chars:
            commas = [j for j, x in enumerate(cur) if re.search(r"[,;:]$", x[2])]
            flush(commas[-1] + 1 if commas and commas[-1] >= 3 else None)
    flush()
    return out


# ---------------------------------------------------------------------------------------------- parts
def plan_parts(n, fps, part_s, words):
    """Frame indices of the cuts [0, c1, ..., n]: equal parts of at most part_s seconds, each cut in a pause between words."""
    dur = n / fps; k = math.ceil(dur / part_s - 1e-9)
    if k > 1 and dur > k * part_s * 0.93: k += 1            # leave room to move the cuts onto pauses
    if k <= 1: return [0, n]
    L = dur / k; gaps = []
    for (s0, e0, w0), (s1, _, _) in zip(words, words[1:]):
        gaps.append(((e0 + s1) / 2, max(0.0, s1 - e0) + (0.4 if _ends_sentence(w0) else 0.0)))
    cuts = [0]
    for i in range(1, k):
        target, prev = i * L, cuts[-1] / fps
        lo = max(target - 0.25 * L, prev + 0.5 * L, dur - (k - i) * part_s); hi = min(target + 0.25 * L, prev + part_s)
        cand = [g for g in gaps if lo <= g[0] <= hi]
        mid = max(cand, key=lambda g: (round(g[1], 2), -abs(g[0] - target)))[0] if cand else min(max(target, lo), hi)
        c = int(round(mid * fps)); c = max(cuts[-1] + 1, min(c, n - 1)); cuts.append(c)
    return cuts + [n]


# ---------------------------------------------------------------------------------------------- helpers
def run(cmd, **kw):
    return subprocess.run(cmd, check=True, **kw)


def render_chunk(args_list):
    r = subprocess.run(args_list, capture_output=True, text=True, cwd=HERE)
    if r.returncode != 0 or "FATAL" in r.stdout:
        sys.exit("render failed:\n" + r.stdout[-800:] + r.stderr[-800:])
    return r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""


def code_fingerprint(scene):
    """Hash of everything that changes how a frame looks, so stale frames are never reused."""
    h = hashlib.sha1()
    files = [os.path.join(HERE, "page.html"), os.path.join(HERE, "render.js"), os.path.join(HERE, "scenes", scene + ".js")]
    for root in (os.path.join(HERE, "lib"), os.path.join(SKILL, "objects")):
        for dp, _, fs in sorted(os.walk(root)):
            files += [os.path.join(dp, f) for f in sorted(fs) if f.endswith((".js", ".json")) and "previews" not in dp]
    for f in files:
        if os.path.exists(f): h.update(f.encode()); h.update(open(f, "rb").read())
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scene", required=True); ap.add_argument("--transcript"); ap.add_argument("--seconds", type=float)
    ap.add_argument("--aspect", default="9:16", help="9:16 (Shorts, default) or 16:9 (YouTube); also: vertical, landscape, youtube, long ...")
    ap.add_argument("--mode", choices=("draft", "fast", "final"), default="draft"); ap.add_argument("--out", default=None)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--audio", help="optional SFX/music stem (NO voice-over) covering the whole timeline; sliced per part")
    ap.add_argument("--caps", choices=("word", "sentence", "0"), help="caption style (default: word for 9:16, sentence for 16:9; 0 = none)")
    ap.add_argument("--capscale", type=float, default=1.0, help="caption size multiplier"); ap.add_argument("--accent", default="#ffd23f", help="lit-word colour (sentence captions)")
    ap.add_argument("--part-seconds", type=float, default=30.0, help="longest part; a longer video is cut into equal parts snapped to pauses")
    ap.add_argument("--chunk", type=int, default=120); ap.add_argument("--jobs", type=int, default=1)
    ap.add_argument("--tail", type=float, default=0.7, help="seconds of picture after the last word")
    ap.add_argument("--fresh", action="store_true", help="wipe this aspect+mode's frames and render from scratch")
    ap.add_argument("--no-qa", action="store_true")
    a = ap.parse_args()
    asp = ASPECT_NAMES.get(a.aspect.lower().replace(" ", ""))
    if not asp: sys.exit("unknown --aspect %r (use 9:16 or 16:9)" % a.aspect)
    W, H, SUB = SIZES[asp][a.mode]; OW, OH = OUT_SIZE[asp]; tag = asp.replace(":", "x")
    caps = a.caps or ("sentence" if asp == "16:9" else "word")
    out = os.path.abspath(a.out or os.path.join("out", f"{a.scene}_{tag}_{a.mode}"))
    frames = os.path.join(out, "frames", f"{tag}-{a.mode}"); os.makedirs(out, exist_ok=True)

    words_file, dur, ws = None, a.seconds, None
    if a.transcript:
        ws = parse_transcript(a.transcript); words_file = os.path.join(out, "words.json")
        json.dump({"word": captions(ws), "sentence": sentences(ws)}, open(words_file, "w"))
        dur = dur or ws[-1][1] + a.tail
    if not dur: sys.exit("give --transcript or --seconds")
    n = int(round(dur * a.fps)); node = shutil.which("node") or sys.exit("node not found")

    # stale-frame guard: frames are reused only when nothing that affects the picture changed
    sig = hashlib.sha1(json.dumps([asp, a.mode, W, H, SUB, a.fps, caps, a.capscale, a.accent, code_fingerprint(a.scene),
                                   open(words_file).read() if words_file else ""]).encode()).hexdigest()
    sig_file = os.path.join(frames, "signature.txt")
    if os.path.isdir(frames) and (a.fresh or not os.path.exists(sig_file) or open(sig_file).read().strip() != sig):
        if os.listdir(frames): print("--fresh: re-rendering from scratch" if a.fresh else "scene, transcript or settings changed: re-rendering from scratch")
        shutil.rmtree(frames)
    os.makedirs(frames, exist_ok=True); open(sig_file, "w").write(sig)

    base = [node, "render.js", "--scene", a.scene, "--w", str(W), "--h", str(H), "--fps", str(a.fps), "--sub", str(SUB),
            "--caps", caps, "--capscale", str(a.capscale), "--accent", a.accent]
    if words_file: base += ["--words", words_file]
    chunks = [(s, min(s + a.chunk - 1, n - 1)) for s in range(0, n, a.chunk)]
    print(f"[{asp} {a.mode}] {n} frames ({dur:.2f}s) at {W}x{H}, blur x{SUB}, captions: {caps}, {len(chunks)} chunk(s)"); t0 = time.time()
    cmds = [base + ["--frames", f"{s}-{e}", "--out", frames] for s, e in chunks]
    with cf.ThreadPoolExecutor(max_workers=max(1, a.jobs)) as ex:
        for msg in ex.map(render_chunk, cmds): print("  ", msg)
    missing = [i for i in range(n) if not os.path.exists(os.path.join(frames, f"{i:04d}.jpg"))]
    if missing: sys.exit(f"{len(missing)} frames missing (first: {missing[0]}); re-run the same command to resume")
    rt = time.time() - t0

    # ---- parts: equal pieces of one continuous timeline, cuts on pauses
    if ws or n / a.fps <= a.part_seconds: cuts = plan_parts(n, a.fps, a.part_seconds, ws or [])
    else:                                             # no word times (--seconds only): equal parts on frame boundaries
        k = math.ceil(n / (a.part_seconds * a.fps)); cuts = [round(i * n / k) for i in range(k)] + [n]
    for f in os.listdir(out):                         # remove outputs of an earlier run with a different part count
        if re.fullmatch(r"(video|part-\d+)\.mp4", f): os.remove(os.path.join(out, f))
    parts = []
    for p in range(len(cuts) - 1):
        a0, b0 = cuts[p], cuts[p + 1]; name = "video.mp4" if len(cuts) == 2 else f"part-{p + 1:02d}.mp4"; mp4 = os.path.join(out, name)
        enc = ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(a.fps), "-start_number", str(a0), "-i", os.path.join(frames, "%04d.jpg")]
        if a.audio: enc += ["-ss", f"{a0 / a.fps:.3f}", "-t", f"{(b0 - a0) / a.fps:.3f}", "-i", a.audio]
        enc += ["-frames:v", str(b0 - a0), "-vf", f"scale={OW}:{OH}:flags=lanczos", "-c:v", "libx264", "-preset", "slow" if a.mode == "final" else "medium",
                "-crf", "15", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
        if a.audio: enc += ["-c:a", "aac", "-b:a", "192k"]
        run(enc + [mp4]); mb = os.path.getsize(mp4) / 1048576
        parts.append({"file": name, "start": round(a0 / a.fps, 3), "end": round(b0 / a.fps, 3), "frames": b0 - a0, "seconds": round((b0 - a0) / a.fps, 2),
                      "mb": round(mb, 1), "over_45mb": mb > SIZE_SHRINK_MB})
        print(f"  {name}: {parts[-1]['start']:.2f}-{parts[-1]['end']:.2f}s, {mb:.1f} MB" + ("  (over 45 MB: it is shrunk automatically when saved)" if mb > SIZE_SHRINK_MB else ""))
    json.dump(parts, open(os.path.join(out, "parts.json"), "w"), indent=1)

    report = {"aspect": asp, "mode": a.mode, "captions": caps, "frames": n, "seconds": round(dur, 2), "render_s": round(rt, 1), "s_per_frame": round(rt / n, 3),
              "parts": parts, "audio": "stem muxed (no voice)" if a.audio else "none (silent; voice-over is added in the editor)", "uploaded": False}
    if not a.no_qa:
        try: import numpy  # QA scripts need numpy
        except ImportError: a.no_qa = True; print("QA skipped: numpy missing (pip install numpy --break-system-packages)"); report["qa"] = "skipped: numpy missing"
    if not a.no_qa:
        first = os.path.join(out, parts[0]["file"])
        for name in ("analyze_pacing", "flicker"):
            cmd = [sys.executable, "-I", os.path.join(SKILL, "scripts", name + ".py"), first]
            if name == "analyze_pacing" and asp == "16:9": cmd += ["--size", "320x180"]
            r = subprocess.run(cmd, capture_output=True, text=True); txt = r.stdout.strip()
            if name == "analyze_pacing":
                try:
                    d = json.loads(txt); txt = ", ".join(f"{k}={d[k]}" for k in ("beats_per_min", "frac_still", "frac_fast", "hard_cuts", "L_mean") if k in d)
                except Exception: txt = txt[-300:]
                if asp == "16:9": txt += "   (Shorts targets do not apply to 16:9; calm cuts are expected)"
            report[name] = txt; print(f"--- {name} ({parts[0]['file']}): {txt.splitlines()[0] if name == 'flicker' and txt else txt}")
    json.dump(report, open(os.path.join(out, "report.json"), "w"), indent=1)
    print(f"\nDONE {len(parts)} file(s) in {out}  ({rt:.0f}s render). Nothing was uploaded; save to the shelf only when the owner asks.")
    for p in parts: print("  " + os.path.join(out, p["file"]))


if __name__ == "__main__":
    main()
