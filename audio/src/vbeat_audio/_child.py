"""Sandbox child: runs one cue script. Started by runner.py as ``python -I _child.py PKG_PARENT IN OUT WALL``.

Defence in depth for LLM-written code, NOT a security boundary. Result files go to OUT:
  result.json {"ok", "raw_len", "cues", "stdout"} + out.npy   on success
  error.json  {"type","message","line","source","trace","stdout"}   when the cue script fails
"""
import builtins
import faulthandler
import json
import signal
import sys
import time
import traceback

CUE_FILE = "cue.py"


def _write_json(path, obj):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh)


def main():
    t_start = time.monotonic()
    pkg_parent, in_dir, out_dir, wall = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
    sys.path.insert(0, pkg_parent)
    # tracebacks of CPU-limit kills end up on stderr; the parent reads the cue line from them
    faulthandler.enable()
    faulthandler.register(signal.SIGXCPU, chain=True)

    import numpy  # noqa: F401  (pre-import everything a cue may use before the sandbox hook is installed)
    import scipy.fft  # noqa: F401
    import scipy.ndimage  # noqa: F401
    import scipy.signal  # noqa: F401

    from vbeat_audio import synth
    from vbeat_audio.constants import (ALLOWED_IMPORTS, ALLOWED_SCIPY_SUBMODULES, FORBIDDEN_ATTRS, SAFE_BUILTIN_NAMES,
                                       STDIO_CAP)
    from vbeat_audio.ctx import Ctx

    with open(f"{in_dir}/spec.json", encoding="utf-8") as fh:
        spec = json.load(fh)
    with open(f"{in_dir}/{CUE_FILE}", encoding="utf-8") as fh:
        source = fh.read()
    src_lines = source.splitlines()
    ctx = Ctx(spec)
    sys.modules["synth"] = synth

    # ---- captured print(): keeps the first STDIO_CAP characters, discards the rest
    buf = {"parts": [], "n": 0}

    def _print(*args, sep=" ", end="\n", file=None, flush=False):
        s = sep.join(str(a) for a in args) + end
        room = STDIO_CAP - buf["n"]
        if room > 0:
            buf["parts"].append(s[:room])
            buf["n"] += min(len(s), room)

    real_import = builtins.__import__

    def _import(name, globals=None, locals=None, fromlist=(), level=0):
        if level != 0:
            raise ImportError("relative imports are not allowed in cue scripts")
        if name not in ALLOWED_IMPORTS:
            raise ImportError(f"import of {name!r} is not allowed in cue scripts (allowed: {', '.join(ALLOWED_IMPORTS)})")
        for item in fromlist or ():
            if item == "*":
                if name == "numpy":
                    raise ImportError("'from numpy import *' is not allowed; use 'import numpy as np'")
                continue
            if (name == "scipy" and item not in ALLOWED_SCIPY_SUBMODULES) or item in FORBIDDEN_ATTRS \
                    or item.startswith("__") or (name.startswith("numpy") and item == "random"):
                raise ImportError(f"import of {name}.{item} is not allowed in cue scripts")
        return real_import(name, globals, locals, fromlist, 0)

    safe = {n: getattr(builtins, n) for n in SAFE_BUILTIN_NAMES}
    safe.update({"__import__": _import, "__build_class__": builtins.__build_class__, "print": _print})
    ns = {"__builtins__": safe, "__name__": "cue"}

    def fail(exc_type, message, line=None, trace=()):
        _write_json(f"{out_dir}/error.json", {
            "type": exc_type, "message": str(message)[:600], "line": line,
            "source": src_lines[line - 1].strip()[:200] if line and 0 < line <= len(src_lines) else None,
            "trace": list(trace), "stdout": "".join(buf["parts"])})
        faulthandler.cancel_dump_traceback_later()
        sys.exit(3)

    def from_exc(e):
        frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename == CUE_FILE]
        trace = [{"line": f.lineno, "func": f.name} for f in frames][-6:]
        fail(type(e).__name__, e, frames[-1].lineno if frames else None, trace)

    # hang report: dump the stack 0.5 s before the parent's wall-clock kill, measured from the child's start, so the
    # parent can name the cue line it was stuck on (armed only now so slow imports cannot trigger it early)
    faulthandler.dump_traceback_later(max(0.3, wall - (time.monotonic() - t_start) - 0.5), exit=False)
    try:
        exec(compile(source, CUE_FILE, "exec"), ns)  # noqa: S102
    except BaseException as e:  # noqa: BLE001
        from_exc(e)
    render = ns.get("render")
    if not callable(render):
        fail("MissingRender", "the cue script must define render(ctx) and return a mono float array")
    try:
        result = render(ctx)
    except BaseException as e:  # noqa: BLE001
        from_exc(e)

    import numpy as np
    if result is None:
        fail("BadReturn", "render() returned None; end it with 'return m.render()'")
    try:
        arr = np.asarray(result)
    except Exception as e:  # noqa: BLE001
        fail("BadReturn", f"render() must return a 1-D numpy float array; got {type(result).__name__}: {e}")
    if arr.dtype.kind not in "fiub":
        fail("BadReturn", f"render() must return a numeric float array; got {type(result).__name__} (dtype {arr.dtype})")
    if arr.ndim != 1:
        fail("BadReturn", f"render() must return a mono 1-D array; got shape {arr.shape} (use x.mean(axis=1) or "
                          "return m.render())")
    raw_len = int(arr.shape[0])
    keep = ctx.samples + 2 * ctx.sr  # never write more than 2 s beyond the beat (file-size limit)
    arr = arr[:keep].astype(np.float32)
    np.save(f"{out_dir}/out.npy", arr, allow_pickle=False)
    cues = []
    for m in ctx._mixes:
        cues.extend(m.cues)
    cues.sort(key=lambda c: (c.get("onset", c["t"]), c["name"]))
    faulthandler.cancel_dump_traceback_later()
    _write_json(f"{out_dir}/result.json", {"ok": True, "raw_len": raw_len, "cues": cues, "stdout": "".join(buf["parts"])})


if __name__ == "__main__":
    main()
