"""sfx_preview.jpg: waveform strip with cue lines and marker triangles above a log-frequency spectrogram.

Written for a vision model: big labels, one warm colour map defined here, no tiny text. Host side only (Pillow).
"""
from __future__ import annotations

import io
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from . import analysis
from .constants import SR

W, H = 1200, 640
JPEG_QUALITY = 85
MAX_BYTES = 300 * 1024
F_LO, F_HI = 60.0, 16000.0
RANGE_DB = 70.0
KIND_LETTER = {"pop": "P", "tick": "K", "whoosh": "W", "thud": "D", "stamp": "S", "slide": "L", "chime": "C", "rustle": "R"}

_BG = (18, 14, 12)
_FG = (240, 232, 220)
_DIM = (130, 118, 105)
_CUE = (110, 220, 255)
_MARK = (255, 214, 90)


def warm_lut():
    """256x3 uint8 colour map: black -> plum -> red -> orange -> yellow -> cream (loud)."""
    stops = [(0.0, (10, 8, 18)), (0.18, (58, 16, 52)), (0.38, (140, 30, 40)), (0.58, (222, 88, 24)),
             (0.80, (250, 190, 64)), (1.0, (255, 250, 224))]
    xs = [s[0] for s in stops]
    u = np.linspace(0, 1, 256)
    return np.stack([np.interp(u, xs, [s[1][c] for s in stops]) for c in range(3)], axis=1).astype(np.uint8)


_LUT = warm_lut()


def font(size):
    """A readable font of the given pixel size (FreeType default, else DejaVu, else Pillow's bitmap font)."""
    try:
        return ImageFont.load_default(size=size)
    except Exception:  # pragma: no cover - very old Pillow
        for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",):
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
        return ImageFont.load_default()


def _text_w(d, s, f):
    return d.textlength(s, font=f)


def spectrogram_image(x, width, height):
    """RGB uint8 image (height, width, 3) of the log-frequency spectrogram of x (60 Hz..16 kHz, 70 dB range)."""
    freqs, times, S = analysis.stft_db(x, 2048, 512, RANGE_DB)
    rows = analysis.log_rows(S, freqs, height, F_LO, F_HI)  # (height, n_frames)
    cols = np.linspace(0, rows.shape[1] - 1, width)
    c0 = np.clip(np.floor(cols).astype(int), 0, rows.shape[1] - 2) if rows.shape[1] > 1 else np.zeros(width, int)
    if rows.shape[1] > 1:
        w = cols - c0
        img = rows[:, c0] * (1 - w) + rows[:, c0 + 1] * w
    else:
        img = np.repeat(rows, width, axis=1)
    idx = np.clip(((img + RANGE_DB) / RANGE_DB * 255.0).round().astype(int), 0, 255)
    return _LUT[idx]


def _freq_y(f, top, h):
    return top + (math.log(F_HI) - math.log(f)) / (math.log(F_HI) - math.log(F_LO)) * h


def _time_step(dur):
    return 0.5 if dur <= 8.0 else (1.0 if dur <= 30.0 else 5.0)


def render_preview(samples, spec, cues, path):
    """Write the 1200x640 preview JPEG for the final audio. Returns the file size in bytes."""
    x = np.asarray(samples, dtype=np.float64)
    dur = len(x) / SR
    L, R = 84, 24
    pw = W - L - R
    img = Image.new("RGB", (W, H), _BG)
    d = ImageDraw.Draw(img)
    f_big, f_mid, f_sm = font(20), font(16), font(15)

    peak_db = 20 * math.log10(max(float(np.abs(x).max()), 1e-9))
    d.text((L, 6), f"SFX preview  {dur:.2f} s  {spec.get('fps', '?')} fps  peak {peak_db:.1f} dBFS  "
                   f"{len(cues)} cues  {len(spec.get('markers', []))} markers", fill=_FG, font=f_big)
    d.text((L, 32), "waveform on top, spectrogram below (bright = loud, 70 dB range). blue lines = cue onsets, "
                    "yellow triangles = scene markers", fill=_DIM, font=f_sm)
    legend = "  ".join(f"{v}={k}" for k, v in KIND_LETTER.items())
    d.text((L, 52), "marker letters: " + legend, fill=_DIM, font=f_sm)

    def tx(t):
        return L + (t / dur) * pw if dur > 0 else L

    # --- waveform strip
    wy0, wy1 = 128, 268
    wm = (wy0 + wy1) // 2
    d.rectangle([L, wy0, L + pw, wy1], outline=(70, 60, 52), fill=(26, 20, 17))
    d.line([L, wm, L + pw, wm], fill=(60, 50, 44))
    per = max(1, int(math.ceil(len(x) / pw)))
    n_cols = int(math.ceil(len(x) / per))
    pad = np.pad(x, (0, n_cols * per - len(x)))
    blk = pad.reshape(n_cols, per)
    mx, mn = blk.max(axis=1), blk.min(axis=1)
    half = (wy1 - wy0) / 2 - 3
    scale = half / max(float(np.abs(x).max()), 1e-9)
    for i in range(n_cols):
        px = L + i * pw / n_cols
        d.line([px, wm - mx[i] * scale, px, wm - mn[i] * scale], fill=(255, 176, 70))
    d.text((8, wy0), "wave", fill=_DIM, font=f_mid)
    d.text((8, wy0 + 20), "(norm.)", fill=_DIM, font=f_sm)

    # --- spectrogram
    sy0, sy1 = 312, 596
    sh = sy1 - sy0
    img.paste(Image.fromarray(spectrogram_image(x, pw, sh)), (L, sy0))
    d.rectangle([L, sy0, L + pw, sy1], outline=(70, 60, 52))
    for fq, lab in ((100, "100"), (500, "500"), (1000, "1k"), (2000, "2k"), (5000, "5k"), (10000, "10k")):
        y = _freq_y(fq, sy0, sh)
        d.line([L - 6, y, L, y], fill=_FG)
        d.line([L, y, L + pw, y], fill=(90, 78, 70))
        d.text((L - 10 - _text_w(d, lab, f_mid), y - 9), lab, fill=_FG, font=f_mid)
    d.text((8, sy0 - 2), "Hz", fill=_DIM, font=f_mid)

    # --- time axis and vertical grid
    step = _time_step(dur)
    k = 0
    while k * step <= dur + 1e-9:
        t = k * step
        px = tx(t)
        d.line([px, wy0, px, wy1], fill=(52, 44, 38))
        d.line([px, sy0, px, sy1 + 6], fill=(150, 135, 120) if k else _FG)
        lab = f"{t:g}" if step >= 1 else f"{t:.1f}"
        d.text((min(px - _text_w(d, lab, f_mid) / 2, W - 30), sy1 + 8), lab, fill=_FG, font=f_mid)
        k += 1
    d.text((L + pw / 2 - 30, sy1 + 28), "time (s)", fill=_DIM, font=f_mid)

    # --- cue lines and labels (3 stacked label rows)
    for i, c in enumerate(cues):
        t = c.get("onset", c.get("t", 0.0))
        px = tx(min(max(t, 0.0), dur))
        d.line([px, 76, px, wy1], fill=_CUE, width=2)
        d.line([px, sy0, px, sy1], fill=(120, 200, 235), width=1)
        for tt in (c.get("times") or [])[1:]:
            qx = tx(min(max(tt, 0.0), dur))
            d.line([qx, wy0, qx, wy0 + 12], fill=_CUE, width=1)
            d.line([qx, sy0, qx, sy0 + 10], fill=(120, 200, 235), width=1)
        name = str(c.get("name", "cue"))[:18] + (f" x{c['n']}" if c.get("kind") == "group" else "")
        row = 78 + (i % 3) * 16
        tw = _text_w(d, name, f_sm)
        lx = px + 4 if px + 4 + tw < W - 6 else px - 4 - tw
        d.text((lx, row - 2), name, fill=_CUE, font=f_sm)

    # --- scene marker triangles + letters (bottom of waveform strip)
    for m in spec.get("markers", []):
        px = tx(m["t"])
        d.polygon([(px - 7, wy1 + 14), (px + 7, wy1 + 14), (px, wy1 + 1)], fill=_MARK)
        d.text((px - 5, wy1 + 14), KIND_LETTER.get(m["kind"], "?"), fill=_MARK, font=f_mid)
        d.line([px, sy0, px, sy0 + 10], fill=_MARK, width=2)

    buf = io.BytesIO()
    q = JPEG_QUALITY
    img.save(buf, "JPEG", quality=q)
    while buf.tell() > MAX_BYTES and q > 50:  # safety net; 85 is normally far below 300 KB
        q -= 5
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=q)
    with open(path, "wb") as fh:
        fh.write(buf.getvalue())
    return buf.tell()


def render_grid(items, path, cols=4, cell=(400, 232)):
    """Labelled grid of spectrograms: items = [(title, subtitle, samples)]. Used for demo/recipes/_catalog.jpg."""
    cw, ch = cell
    rows = int(math.ceil(len(items) / cols))
    img = Image.new("RGB", (cols * cw, rows * ch + 34), _BG)
    d = ImageDraw.Draw(img)
    f_t, f_s, f_h = font(17), font(14), font(18)
    d.text((10, 6), "recipe catalog: spectrograms 60 Hz to 16 kHz (log axis, 70 dB range). x axis = each sound's own length",
           fill=_FG, font=f_h)
    for i, (title, sub, x) in enumerate(items):
        ox, oy = (i % cols) * cw, (i // cols) * ch + 34
        d.text((ox + 8, oy + 4), title, fill=_FG, font=f_t)
        d.text((ox + 8, oy + 24), sub, fill=_DIM, font=f_s)
        gx0, gy0, gw, gh = ox + 44, oy + 46, cw - 54, ch - 70
        img.paste(Image.fromarray(spectrogram_image(np.asarray(x, dtype=np.float64), gw, gh)), (gx0, gy0))
        d.rectangle([gx0, gy0, gx0 + gw, gy0 + gh], outline=(70, 60, 52))
        for fq, lab in ((100, "100"), (1000, "1k"), (10000, "10k")):
            y = _freq_y(fq, gy0, gh)
            d.line([gx0 - 4, y, gx0 + gw, y], fill=(110, 96, 86))
            d.text((gx0 - 8 - _text_w(d, lab, f_s), y - 8), lab, fill=_FG, font=f_s)
        dur = len(x) / SR
        end = f"{dur * 1000:.0f} ms"
        d.text((gx0 + gw - _text_w(d, end, f_s), gy0 + gh + 3), end, fill=_FG, font=f_s)
        d.text((gx0, gy0 + gh + 3), "0", fill=_FG, font=f_s)
    img.save(path, "JPEG", quality=JPEG_QUALITY)
    return os.path.getsize(path)


def render_thumb(x, path, size=(360, 170)):
    """Small spectrogram thumbnail (no text) for the audition page."""
    w, h = size
    Image.fromarray(spectrogram_image(np.asarray(x, dtype=np.float64), w, h)).save(path, "JPEG", quality=80)
    return os.path.getsize(path)
