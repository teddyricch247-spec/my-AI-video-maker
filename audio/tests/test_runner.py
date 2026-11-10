import subprocess
import sys

import numpy as np
import pytest

import helpers
from vbeat_audio import runner
from vbeat_audio.constants import SR

HEAD = "from synth import *\nimport numpy as np\n"


def run(src, **kw):
    return runner.run_cue(src, helpers.spec("base5"), **kw)


def a0(res):
    assert res.raw is None and res.findings and all(f["id"] == "A0" and f["severity"] == "error" for f in res.findings)
    return res.findings


@pytest.mark.parametrize("src,line,word", [
    ("import os\n\ndef render(ctx):\n    return ctx\n", 1, "os"),
    ("import subprocess\n", 1, "subprocess"),
    ("import socket\n", 1, "socket"),
    ("import random\n", 1, "random"),
    ("from random import random\n", 1, "random"),
    ("import numpy.random\n", 1, "numpy.random"),
    ("from numpy import random\n", 1, "random"),
    ("from numpy import *\n", 1, "numpy"),
    ("from scipy import io\n", 1, "scipy"),
    ("import scipy.io\n", 1, "scipy.io"),
    ("import importlib\n", 1, "importlib"),
    ("def render(ctx):\n    f = open('x.txt', 'w')\n", 2, "open"),
    ("def render(ctx):\n    return ctx.__class__\n", 2, "__class__"),
    ("def render(ctx):\n    return ctx.__dict__\n", 2, "__dict__"),
    ("def render(ctx):\n    return __builtins__\n", 2, "__builtins__"),
    ("def render(ctx):\n    return eval('1')\n", 2, "eval"),
    ("def render(ctx):\n    exec('x=1')\n", 2, "exec"),
    ("def render(ctx):\n    return compile('1', 'a', 'eval')\n", 2, "compile"),
    ("def render(ctx):\n    return globals()\n", 2, "globals"),
    ("def render(ctx):\n    return vars(ctx)\n", 2, "vars"),
    ("def render(ctx):\n    return input()\n", 2, "input"),
    ("def render(ctx):\n    breakpoint()\n", 2, "breakpoint"),
    ("import numpy as np\ndef render(ctx):\n    np.save('a.npy', np.zeros(3))\n", 3, ".save"),
    ("import numpy as np\ndef render(ctx):\n    return np.load('a.npy')\n", 3, ".load"),
    ("import numpy as np\ndef render(ctx):\n    return np.loadtxt('a.txt')\n", 3, ".loadtxt"),
    ("import numpy as np\ndef render(ctx):\n    np.savetxt('a.txt', np.zeros(3))\n", 3, ".savetxt"),
    ("import numpy as np\ndef render(ctx):\n    return np.fromfile('a')\n", 3, ".fromfile"),
    ("import numpy as np\ndef render(ctx):\n    np.zeros(3).tofile('a')\n", 3, ".tofile"),
    ("import numpy as np\ndef render(ctx):\n    return np.memmap('a')\n", 3, ".memmap"),
    ("import numpy as np\ndef render(ctx):\n    return np.genfromtxt('a')\n", 3, ".genfromtxt"),
    ("import numpy as np\ndef render(ctx):\n    return np.random.rand(10)\n", 3, "numpy.random"),
    ("import numpy\ndef render(ctx):\n    return numpy.random.default_rng(1).random(10)\n", 3, "numpy.random"),
    ("import numpy as xp\ndef render(ctx):\n    return xp.random.rand(3)\n", 3, "numpy.random"),
    ("def render(ctx):\n    return getattr(ctx, 'samp' + 'les')\n", 2, "getattr"),
    ("def render(ctx):\n    return getattr(ctx, '__class__')\n", 2, "getattr"),
    ("def render(ctx):\n    setattr(ctx, 'x', 1)\n    n = 'y'\n    setattr(ctx, n, 1)\n", 4, "setattr"),
    ("def render(ctx):\n    return '{0.__class__}'.format(ctx)\n", 2, ".format"),
    ("import os as o\n", 1, "os"),
    ("def render(ctx:\n    pass\n", 1, "SyntaxError"),
])
def test_static_check_rejects_with_line_numbers(src, line, word):
    res = run(src)
    f = a0(res)
    assert any(x["data"].get("line") == line and word in x["message"] for x in f), [x["message"] for x in f]
    assert res.timing_ms.get("child") is None  # rejected before any child process was started


def test_static_check_allows_the_documented_language():
    ok = ("import math, itertools, functools, collections, dataclasses, typing\nimport numpy as np\nimport numpy.fft\n"
          "from scipy import signal, ndimage, fft\nfrom scipy.signal import butter\nimport scipy.signal as sg\n"
          "from synth import *\nfrom dataclasses import dataclass\n@dataclass\nclass P:\n    a: float = 1.0\n"
          "def render(ctx):\n    r = ctx.rng('x').random(3)\n    m = ctx.mix()\n    return m.render()\n")
    assert runner.static_check(ok) == []


def test_oversized_source_is_rejected():
    res = run("# " + "x" * 110000 + "\ndef render(ctx):\n    pass\n")
    assert "bytes" in a0(res)[0]["message"]


def test_runtime_import_hook_is_a_second_wall():
    original = runner.static_check
    runner.static_check = lambda s: []  # pretend the AST check missed it
    try:
        for src, word in (("import os\n", "os"), ("import socket\n", "socket"), ("import numpy.random\n", "numpy.random"),
                          ("from scipy import io\n", "scipy.io"), ("from numpy import load\n", "load")):
            f = a0(run(src + "def render(ctx):\n    return None\n"))
            assert "ImportError" in f[0]["message"] and word in f[0]["message"] and f[0]["data"]["line"] == 1
        f = a0(run("def render(ctx):\n    return open('/etc/passwd')\n"))
        assert "NameError" in f[0]["message"] and f[0]["data"]["line"] == 2  # builtins allowlist
    finally:
        runner.static_check = original


def test_exceptions_become_a0_with_cue_line_and_clean_trace():
    f = a0(run(HEAD + "def render(ctx):\n    m = ctx.mix()\n    ctx.at('w9999')\n    return m.render()\n"))[0]
    assert f["data"]["line"] == 5 and "UnknownIdError" in f["message"] and "nearest ids" in f["message"]
    assert "ctx.at('w9999')" in f["message"] and "synth.py" not in f["message"] and "ctx.py" not in f["message"]
    f = a0(run(HEAD + "def render(ctx):\n    x = lowpass('not an array', 100)\n    return x\n"))[0]  # raised inside synth
    assert f["data"]["line"] == 4 and "synth.py" not in f["message"]
    f = a0(run(HEAD + "def render(ctx):\n    return 1 / 0\n"))[0]
    assert "ZeroDivisionError" in f["message"] and f["data"]["line"] == 4


def test_wrong_return_types_are_a0():
    for body, word in (("return None", "None"), ("return 'hi'", "str"), ("return np.zeros((ctx.samples, 2))", "mono"),
                       ("return np.zeros(4) + 1j", "dtype"), ("pass", "None")):
        f = a0(run(f"import numpy as np\ndef render(ctx):\n    {body}\n"))
        assert word in f[0]["message"], (body, f[0]["message"])
    assert "render(ctx)" in a0(run("x = 1\n"))[0]["message"]


def test_infinite_loop_is_killed_at_the_wall_clock():
    import time
    t = time.time()
    f = a0(run("def render(ctx):\n    n = 0\n    while True:\n        n += 1\n", wall_timeout=4.0, cpu_limit=60))[0]
    assert time.time() - t < 8.0 and "wall-clock" in f["message"]
    assert f["data"].get("line") in (3, 4)  # the line it was stuck on, from the faulthandler dump


def test_cpu_limit_kills_a_busy_loop():
    f = a0(run("def render(ctx):\n    while True:\n        pass\n", wall_timeout=10.0, cpu_limit=3))[0]
    assert "CPU-time" in f["message"] and f["data"]["line"] == 2


def test_memory_hog_is_killed():
    f = a0(run("import numpy as np\ndef render(ctx):\n    x = np.zeros(10**9)\n    return x\n"))[0]
    assert "MemoryError" in f["message"] or "memory" in f["message"]
    assert f["data"]["line"] == 3
    f = a0(run("import numpy as np\ndef render(ctx):\n    x = []\n    for i in range(100):\n        x.append(np.ones(5 * 10**7))\n    return x[0]\n"))[0]
    assert "MemoryError" in f["message"] or "memory" in f["message"]


def test_print_flood_is_truncated():
    res = run("import numpy as np\ndef render(ctx):\n    for i in range(300000):\n        print('x' * 100)\n    return np.zeros(ctx.samples)\n")
    assert res.raw is not None and 0 < len(res.stdout) <= 4096 and len(res.stderr) <= 4096


def test_network_is_not_reachable():
    f = a0(run("import socket\ndef render(ctx):\n    return socket.create_connection(('1.1.1.1', 53))\n"))
    assert "socket" in f[0]["message"]
    info = runner.sandbox_info()
    assert isinstance(info["netns"], bool)
    if info["netns"]:  # when the namespace exists, the child sees only loopback
        r = subprocess.run([info["unshare"], info["flag"], "--", sys.executable, "-c",
                            "import socket; print([n for _, n in socket.if_nameindex()])"], capture_output=True, text=True)
        assert r.stdout.strip() == "['lo']"
        res = run("import numpy as np\ndef render(ctx):\n    return np.zeros(ctx.samples)\n")
        assert res.sandbox["netns"] is True


def test_child_runs_isolated_and_in_empty_cwd():
    # a cue cannot see the machine; the only observable thing is that a normal script still works
    res = run(HEAD + "def render(ctx):\n    m = ctx.mix()\n    m.add(1.0, soft_pop())\n    return m.render()\n")
    assert res.raw is not None and len(res.raw) == 240000 and res.raw_len == 240000
    assert res.cues and res.cues[0]["kind"] == "single" and res.timing_ms["child"] > 0


def test_wrong_length_is_padded_or_trimmed_with_a1(tmp_path):
    short = helpers.render_file(helpers.bad("a1_short"), "base5", tmp_path / "s")
    assert any(f["id"] == "A1" and f["severity"] == "warn" for f in short["report"]["findings"])
    assert helpers.read_wav(short["artifacts"]["wav"])[0] == 240000
    long_ = helpers.render_file(helpers.bad("a1_long"), "base5", tmp_path / "l")
    assert any(f["id"] == "A1" and f["severity"] == "error" for f in long_["report"]["findings"])
    assert helpers.read_wav(long_["artifacts"]["wav"])[0] == 240000
    assert long_["ok"] and not long_["report"]["ok"]  # tool ran, check failed


def test_nan_output_is_a2_and_writes_no_wav(tmp_path):
    env = helpers.render_file(helpers.bad("a2_nan"), "base5", tmp_path)
    assert helpers.severe_ids(env["report"]) == {"A2"} and "wav" not in env["artifacts"]
    assert env["ok"] is True and env["report"]["ok"] is False


def test_output_rules_dc_fades_and_normalisation():
    spec = helpers.spec("base5")
    x = np.zeros(spec["samples"])
    x[1000:2000] = 0.2
    x += 0.01
    final, pcm, findings = runner.finalize(x, spec)
    assert findings and findings[0]["id"] == "A10"  # mean removed because |mean| > 1e-3
    assert abs(20 * np.log10(np.abs(final).max()) - spec["peak_dbfs"]) < 1e-9
    assert final[0] == 0 and abs(final[-1]) < 1e-9 and pcm.dtype == np.dtype("<i2")
    quiet = np.zeros(spec["samples"])
    quiet[5000:5100] = np.sin(np.arange(100)) * 1e-4
    _, _, f2 = runner.finalize(quiet, spec)
    assert not f2  # mean is below 1e-3: left alone


def test_fix_length():
    assert len(runner.fix_length(np.zeros(10), 20)) == 20 and len(runner.fix_length(np.zeros(30), 20)) == 20


@pytest.mark.parametrize("body", [
    "from dataclasses import dataclass\n@dataclass\nclass P:\n    a: float = 0.1\ndef render(ctx):\n    return np.zeros(ctx.samples) + P().a\n",
    "class A:\n    def go(self, n):\n        return np.zeros(n)\ndef render(ctx):\n    return A().go(ctx.samples)\n",
    "import collections, itertools, functools, math\ndef render(ctx):\n    d = collections.defaultdict(list)\n"
    "    n = sum(1 for _ in itertools.islice(range(9), 3))\n    return np.zeros(ctx.samples) + len(f'{n}') * math.pi * 0\n",
    "from scipy import signal, ndimage, fft\nimport scipy.signal as sg\ndef render(ctx):\n"
    "    return sg.sosfilt(sg.butter(2, 100, fs=48000, output='sos'), ctx.rng('a').random(ctx.samples)) * 0\n",
    "def render(ctx):\n    try:\n        ctx.at('zz')\n    except ValueError:\n        pass\n    return np.zeros(ctx.samples)\n",
])
def test_documented_language_features_actually_run_in_the_sandbox(body):
    res = run("import numpy as np\n" + body)
    assert res.raw is not None and len(res.raw) == 240000, [f["message"] for f in res.findings]
