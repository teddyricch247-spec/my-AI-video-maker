#!/usr/bin/env python3
"""SFX-only procedural audio stem for fake-door-part3 (NO music, NO voice-over)."""
import math
import struct
import wave
from pathlib import Path

SR = 48000
DUR = 30.70
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


def add_whoosh(t0, dur=0.16, amp=0.12):
    i0 = int(t0 * SR)
    count = int(dur * SR)
    for k in range(count):
        u = k / max(1, count - 1)
        air = math.sin(k * 0.21 + math.sin(k * 0.07)) * math.cos(k * 0.53)
        sub = math.sin(2.0 * math.pi * (160.0 + 180.0 * u) * (k / SR))
        env = math.sin(math.pi * u) ** 1.4
        add_sample(i0 + k, amp * env * (0.6 * air + 0.4 * sub))


# --- ACT A: Rival Launches & Refreshes -> Zero (0..5.20s) ---
add_click(0.92, 0.032, 1450.0, amp=0.16)       # launch click
add_click(1.75, 0.030, 1650.0, amp=0.14)       # F5 refresh click
add_tone(3.05, 0.32, 340.0, 140.0, amp=0.22, wave_type="tri", decay=6.5)  # "says zero" sad drop

# --- ACT B: Courtyard Painted Doors -> Open Shop -> Paid! (5.20..22.15s) ---
add_whoosh(5.18, 0.16, amp=0.13)               # cut to courtyard
add_tone(8.85, 0.16, 520.0, 780.0, amp=0.16, wave_type="sine", decay=8.5)  # "fake door test" pop
# Brass handle jiggle rattles (12.9..14.3s)
add_click(13.00, 0.038, 920.0, amp=0.15)
add_click(13.42, 0.038, 980.0, amp=0.15)
add_click(13.85, 0.038, 1040.0, amp=0.16)
add_tone(13.10, 0.14, 720.0, 1080.0, amp=0.15, wave_type="sine", decay=9.0)  # 190 counter ping

# Door 2 swings open & room pops up (15.80..17.00s)
add_whoosh(15.80, 0.22, amp=0.16)
add_tone(16.15, 0.24, 380.0, 760.0, amp=0.18, wave_type="sine", decay=7.0)

# Stranger pays $49! Crisp cash-register cha-ching double ding (20.75..21.40s)
add_tone(20.75, 0.20, 1046.5, 1046.5, amp=0.21, wave_type="sine", decay=7.5)
add_tone(20.92, 0.34, 1568.0, 1568.0, amp=0.22, wave_type="sine", decay=5.5)

# --- ACT C: Hard cut back to Rival's 0 dashboard (22.15..24.38s) ---
add_whoosh(22.14, 0.14, amp=0.12)
add_tone(23.50, 0.28, 280.0, 130.0, amp=0.20, wave_type="tri", decay=7.0)  # still zero thud

# --- ACT D: Hard cut to Bright Studio CTA Finale (24.38..30.64s) ---
add_whoosh(24.36, 0.15, amp=0.12)
add_tone(26.22, 0.16, 587.3, 880.0, amp=0.17, wave_type="sine", decay=8.5)   # "Without Claude Code" pop
add_tone(27.82, 0.24, 659.3, 1318.5, amp=0.20, wave_type="sine", decay=7.0)  # "Comment guide" pop chime

peak = max(1e-9, max(abs(x) for x in buf))
target_peak = 0.25
scale = target_peak / peak
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
