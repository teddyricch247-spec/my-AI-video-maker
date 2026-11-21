#!/usr/bin/env python3
"""SFX-only procedural audio stem for fake-door-part2 (NO music, NO voice-over)."""
import math
import struct
import wave
from pathlib import Path

SR = 48000
DUR = 27.95
N = int(SR * DUR)
buf = [0.0] * N


def add_sample(idx, val):
    if 0 <= idx < N:
        buf[idx] += val


def add_tone(t0, dur, f0, f1=None, amp=0.18, wave_type="sine", decay=10.0):
    if f1 is None:
        f1 = f0
    i0 = int(t0 * SR)
    count = int(dur * SR)
    phase = 0.0
    for k in range(count):
        u = k / max(1, count - 1)
        f = f0 + (f1 - f0) * u
        phase += 2.0 * math.pi * f / SR
        if wave_type == "sine":
            s = math.sin(phase)
        elif wave_type == "tri":
            p = (phase / (2.0 * math.pi)) % 1.0
            s = 4.0 * abs(p - 0.5) - 1.0
        else:
            s = math.sin(phase) + 0.35 * math.sin(2.0 * phase)
        env = min(1.0, u / 0.06) * math.exp(-decay * u)
        add_sample(i0 + k, amp * env * s)


def add_click(t0, dur=0.032, freq=1350.0, amp=0.16):
    i0 = int(t0 * SR)
    count = int(dur * SR)
    phase = 0.0
    for k in range(count):
        u = k / max(1, count - 1)
        phase += 2.0 * math.pi * (freq * (1.0 - 0.35 * u)) / SR
        env = min(1.0, u / 0.08) * math.exp(-16.0 * u)
        s = math.sin(phase) * 0.7 + math.sin(phase * 2.1) * 0.3
        add_sample(i0 + k, amp * env * s)


def add_paper_flip(t0, dur=0.09, amp=0.15):
    i0 = int(t0 * SR)
    count = int(dur * SR)
    # Deterministic crisp filtered flutter + low paper thump
    for k in range(count):
        u = k / max(1, count - 1)
        thump = math.sin(2.0 * math.pi * (240.0 - 110.0 * u) * (k / SR))
        crinkle = math.sin(k * 0.43) * math.sin(k * 1.17)
        env = math.sin(math.pi * u) * math.exp(-5.0 * u)
        add_sample(i0 + k, amp * env * (0.65 * thump + 0.35 * crinkle))


def add_whoosh(t0, dur=0.16, amp=0.12):
    i0 = int(t0 * SR)
    count = int(dur * SR)
    for k in range(count):
        u = k / max(1, count - 1)
        air = math.sin(k * 0.21 + math.sin(k * 0.07)) * math.cos(k * 0.53)
        sub = math.sin(2.0 * math.pi * (160.0 + 180.0 * u) * (k / SR))
        env = math.sin(math.pi * u) ** 1.4
        add_sample(i0 + k, amp * env * (0.6 * air + 0.4 * sub))


def add_scribble(t0, dur=0.055, amp=0.13):
    i0 = int(t0 * SR)
    count = int(dur * SR)
    for k in range(count):
        u = k / max(1, count - 1)
        stroke = math.sin(2.0 * math.pi * (780.0 + 260.0 * math.sin(u * 9.0)) * (k / SR))
        env = math.sin(math.pi * u) * math.exp(-4.0 * u)
        add_sample(i0 + k, amp * env * stroke)


# --- ACT A: Rival's Dev Cave (0..13.33s) ---
# 1.35s: Rival picks IDEA 2
add_tone(1.35, 0.14, 520.0, 880.0, amp=0.20, wave_type="sine", decay=8.0)
add_click(1.35, 0.028, 1600.0, amp=0.14)

# 3.76..6.65s: Typing with Claude + 3 weeks calendar flips
for tk in [3.85, 4.02, 4.18, 4.35, 5.95, 6.10, 6.26, 6.42, 6.56]:
    add_click(tk, 0.026, 1150.0 + (int(tk * 100) % 5) * 90.0, amp=0.11)
add_paper_flip(4.50, 0.10, amp=0.16)
add_paper_flip(5.40, 0.10, amp=0.17)

# 6.88..8.95s: Settings page UI toggles
add_click(7.35, 0.032, 1480.0, amp=0.16)
add_click(7.88, 0.032, 1680.0, amp=0.16)
add_click(8.42, 0.032, 1880.0, amp=0.16)

# 9.06s: "Real founders ship!" punchy comic pop
add_tone(9.06, 0.14, 190.0, 420.0, amp=0.22, wave_type="tri", decay=9.0)
add_click(9.82, 0.036, 1400.0, amp=0.15)

# 11.33..13.29s: Polishing loading spinner ticks/squeaks
add_tone(11.75, 0.09, 920.0, 1240.0, amp=0.12, wave_type="sine", decay=10.0)
add_tone(12.35, 0.09, 980.0, 1320.0, amp=0.12, wave_type="sine", decay=10.0)
add_tone(12.88, 0.10, 1040.0, 1400.0, amp=0.12, wave_type="sine", decay=10.0)

# --- ACT B: Bright Studio (13.33..27.92s) ---
# 13.33s: Hard cut to Week 1
add_whoosh(13.31, 0.15, amp=0.13)
add_paper_flip(13.52, 0.09, amp=0.15)

# 15.20s: 9 people click on button
add_click(15.20, 0.034, 1520.0, amp=0.16)
add_tone(15.22, 0.16, 660.0, 880.0, amp=0.14, wave_type="sine", decay=8.0)

# 16.70..17.95s: Sam draws 9 tally marks
for ts in [16.72, 16.88, 17.04, 17.20, 17.36, 17.56, 17.72, 17.88]:
    add_scribble(ts, 0.055, amp=0.14)

# 18.55s: Ada shrugs (soft comic descending boop)
add_tone(18.52, 0.22, 460.0, 220.0, amp=0.18, wave_type="tri", decay=7.0)

# 19.61s: Hard cut to Week 3 calendar flip
add_paper_flip(19.62, 0.10, amp=0.17)

# 21.68s: "212 clicks" counter pop chime
add_tone(21.66, 0.18, 660.0, 990.0, amp=0.20, wave_type="sine", decay=7.0)
add_click(21.66, 0.030, 1750.0, amp=0.15)

# 23.13s: "190 hit the same button" winner double-ding!
add_tone(23.14, 0.24, 880.0, 880.0, amp=0.20, wave_type="sine", decay=6.5)
add_tone(23.30, 0.32, 1318.5, 1318.5, amp=0.22, wave_type="sine", decay=5.5)

# 25.20s: Hard cut to Sam & Ada celebration pop
add_whoosh(25.18, 0.14, amp=0.11)
add_tone(25.24, 0.20, 587.3, 1174.7, amp=0.17, wave_type="sine", decay=7.5)

# Normalize safely to peak ~ -12 dBFS (0.25) so SFX sits cleanly under voice-over
peak = max(1e-9, max(abs(x) for x in buf))
target_peak = 0.25
scale = min(1.0, target_peak / peak) if peak > target_peak else (target_peak / peak)
samples = [max(-1.0, min(1.0, x * scale)) for x in buf]

rms = math.sqrt(sum(x * x for x in samples) / len(samples))
out_path = Path(__file__).with_name("audio_stem.wav")
with wave.open(str(out_path), "wb") as wf:
    wf.setnchannels(1)
    wf.setsampwidth(2)
    wf.setframerate(SR)
    pcm = struct.pack("<" + "h" * len(samples), *[int(x * 32767) for x in samples])
    wf.writeframes(pcm)

print(
    f"Wrote {out_path} ({DUR:.2f}s)  "
    f"peak={20*math.log10(max(abs(x) for x in samples)):.1f} dBFS  "
    f"rms={20*math.log10(max(1e-9, rms)):.1f} dBFS"
)
