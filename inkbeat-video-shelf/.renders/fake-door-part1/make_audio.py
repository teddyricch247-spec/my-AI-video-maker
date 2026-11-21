import math, struct, wave

SR = 48000
DUR = 28.65
N = int(SR * DUR)
TAU = 2.0 * math.pi

def clamp(x, a=-1.0, b=1.0):
    return b if x > b else (a if x < a else x)

def hash_noise(i):
    x = math.sin(i * 127.1 + 311.7) * 43758.5453123
    return (x - math.floor(x)) * 2.0 - 1.0

buf = [0.0] * N

def add_pop(t0, f0, f1, dur, amp):
    i0 = int(t0 * SR)
    m = int(dur * SR)
    phase = 0.0
    for k in range(m):
        idx = i0 + k
        if idx >= N: break
        u = k / m
        env = math.sin(math.pi * min(1.0, u * 8.0)) * math.exp(-7.5 * u)
        freq = f0 + (f1 - f0) * (1.0 - math.exp(-8.0 * u))
        phase += TAU * freq / SR
        buf[idx] += amp * env * math.sin(phase)

def add_chime(t0, freq, dur, amp):
    i0 = int(t0 * SR)
    m = int(dur * SR)
    for k in range(m):
        idx = i0 + k
        if idx >= N: break
        t = k / SR
        env = math.sin(math.pi * min(1.0, k / (0.008 * SR))) * math.exp(-5.5 * t)
        s = 0.75 * math.sin(TAU * freq * t) + 0.25 * math.sin(TAU * freq * 2.0 * t) * math.exp(-10.0 * t)
        buf[idx] += amp * env * s

def add_click(t0, amp, pitch=1400.0):
    i0 = int(t0 * SR)
    m = int(0.045 * SR)
    for k in range(m):
        idx = i0 + k
        if idx >= N: break
        t = k / SR
        env = math.exp(-95.0 * t)
        s = 0.65 * math.sin(TAU * pitch * t) + 0.35 * hash_noise(idx)
        buf[idx] += amp * env * s

def add_tape_rip(t0, dur, amp):
    i0 = int(t0 * SR)
    m = int(dur * SR)
    prev = 0.0
    for k in range(m):
        idx = i0 + k
        if idx >= N: break
        u = k / m
        env = math.sin(math.pi * u) ** 0.7
        # Bandpass-ish crisp paper/tape texture via simple difference + smooth
        raw = hash_noise(idx * 3 + 7)
        hp = raw - prev * 0.65
        prev = raw
        buf[idx] += amp * env * hp * 0.55

# 1) Story SFX ONLY (no voice-over, no music bed)
# 3 BUY buttons pop in
add_pop(0.48, 360, 620, 0.14, 0.24)
add_pop(0.78, 420, 740, 0.14, 0.24)
add_pop(1.08, 490, 880, 0.15, 0.26)

# 3 Idea cards pop onto corkboard
add_chime(4.05, 587.33, 0.28, 0.20)
add_chime(4.45, 659.25, 0.28, 0.20)
add_chime(4.82, 783.99, 0.32, 0.22)

# 40 days calendar tick
add_click(5.86, 0.22, pitch=950.0)

# Mouse click on button + "Not ready yet" comic bonk
add_click(11.35, 0.28, pitch=1600.0)
add_pop(11.75, 240, 125, 0.24, 0.30)

# Empty shelves hollow wood knock
add_pop(17.80, 180, 110, 0.16, 0.26)

# Tapes paper above desk
add_tape_rip(19.95, 0.24, 0.26)
add_pop(20.22, 160, 95, 0.10, 0.18)

# 3 columns appear ("one column per button")
add_click(21.82, 0.22, pitch=1200.0)
add_click(22.22, 0.22, pitch=1320.0)
add_click(22.62, 0.22, pitch=1450.0)

# "rule: no code until ... 100 clicks"
add_pop(24.65, 320, 580, 0.16, 0.24)
add_chime(27.18, 880.0, 0.45, 0.25)

out_path = "inkbeat-video-shelf/.renders/fake-door-part1/audio_stem.wav"
with wave.open(out_path, "wb") as wf:
    wf.setnchannels(1)
    wf.setsampwidth(2)
    wf.setframerate(SR)
    frames = bytearray()
    peak = 0.0
    sq = 0.0
    for v in buf:
        c = clamp(v, -0.95, 0.95)
        peak = max(peak, abs(c))
        sq += c * c
        frames.extend(struct.pack("<h", int(c * 32767)))
    wf.writeframes(frames)

rms = math.sqrt(sq / N)
print(f"Wrote {out_path} ({DUR:.2f}s, peak={20*math.log10(peak+1e-9):.1f} dBFS, rms={20*math.log10(rms+1e-9):.1f} dBFS)")
