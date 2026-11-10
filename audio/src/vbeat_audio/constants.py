"""Frozen constants of the vbeat audio contract (see docs/AUDIO_INTERFACES.md).

This module is pure Python (no numpy) so the sandbox child and the static checker can import it cheaply.
"""
from __future__ import annotations

SR = 48000  # sample rate in Hz, frozen
ALLOWED_FPS = (24, 25, 30, 60)
MARKER_KINDS = ("pop", "tick", "whoosh", "thud", "stamp", "slide", "chime", "rustle")

DEFAULT_PEAK_DBFS = -6.0  # final sample peak of the delivered wav
FADE_MS = 5.0  # linear fade in and out applied by the runner
MAX_BEAT_SECONDS = 60.0  # keeps temp files below the 20 MB file-size limit

# --- sandbox limits (defence in depth for LLM-written code, not a security boundary) ---
MAX_SOURCE_BYTES = 100 * 1024
CPU_LIMIT_S = 15
MEM_LIMIT_BYTES = 1 << 30
FSIZE_LIMIT_BYTES = 20 * 1024 * 1024
NOFILE_LIMIT = 32
WALL_TIMEOUT_S = 20.0
STDIO_CAP = 4096

# --- cue-script language rules (shared by the AST checker and the child's import hook) ---
ALLOWED_IMPORTS = (
    "numpy", "numpy.fft", "scipy", "scipy.signal", "scipy.ndimage", "scipy.fft",
    "math", "functools", "itertools", "collections", "dataclasses", "typing", "synth",
)
ALLOWED_SCIPY_SUBMODULES = ("signal", "ndimage", "fft")
FORBIDDEN_NAMES = (
    "open", "exec", "eval", "compile", "input", "breakpoint", "globals", "locals", "vars",
)
# attribute names that are refused wherever they appear (os.system, np.load, str.format, ...)
FORBIDDEN_ATTRS = (
    "os", "sys", "subprocess", "socket", "ctypes", "system", "popen",
    "load", "save", "loadtxt", "savetxt", "fromfile", "tofile", "memmap", "genfromtxt",
    # extras that close obvious side doors (see docs/DECISIONS.md)
    "savez", "savez_compressed", "fromregex", "DataSource", "ctypeslib", "f2py", "testing",
    "io", "wavfile", "loadmat", "savemat", "datasets", "format", "format_map",
)
SAFE_BUILTIN_NAMES = (
    "abs", "all", "any", "bool", "callable", "chr", "complex", "dict", "divmod", "enumerate",
    "filter", "float", "frozenset", "getattr", "hasattr", "hash", "int", "isinstance",
    "issubclass", "iter", "len", "list", "map", "max", "min", "next", "object", "ord", "pow",
    "property", "range", "repr", "reversed", "round", "set", "setattr", "delattr", "slice",
    "sorted", "staticmethod", "classmethod", "str", "sum", "super", "tuple", "zip",
    "Exception", "ValueError", "TypeError", "IndexError", "KeyError", "ZeroDivisionError",
    "ArithmeticError", "AssertionError", "AttributeError", "RuntimeError", "StopIteration",
    "OverflowError", "NotImplementedError", "FloatingPointError", "LookupError",
    "NotImplemented", "Ellipsis",
)


def samples_for(frames: int, fps: int) -> int:
    """Exact sample count of a beat: frames * SR // fps (SR % fps is asserted to be 0)."""
    assert fps in ALLOWED_FPS, f"fps must be one of {ALLOWED_FPS}, got {fps}"
    assert SR % fps == 0, "SR must be divisible by fps"
    return int(frames) * SR // int(fps)
