#!/usr/bin/env python3
"""Run a command while holding a machine-wide "one render on the GPU" lock (Windows, macOS, Linux; stdlib only).

usage: python gpu_lock.py [--lock PATH] [--wait SECONDS] -- COMMAND [ARGS...]
example: python gpu_lock.py -- npx remotion render build MyComp out.mp4 --gl=angle --timeout=240000

Two WebGL renders sharing one GPU lost GL state and produced dark frames, so every `remotion render` / `remotion still`
should go through this wrapper. The lock is an operating-system file lock (flock on macOS/Linux, msvcrt.locking on
Windows) on an empty lock file. The OS releases it when the process ends, even after a crash, so there are no stale
locks. On macOS/Linux the render inherits the lock; on Windows the render runs in a kill-on-close job object, so
killing this wrapper also ends the render (the lock is never free while a render still runs). The script never writes to, truncates or deletes the lock file, and it refuses an existing file that is not
an empty regular file. Default lock path: <system temp dir>/remotion-gpu.lock. Exits with the command's exit code.
"""
import argparse
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time


def die(msg, code=2):
    print(f"[gpu_lock] {msg}", file=sys.stderr)
    sys.exit(code)


def open_lock(path):
    flags = os.O_CREAT | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_BINARY", 0)
    if os.path.islink(path):
        die(f"{path} is a symbolic link; refusing to use it as a lock")
    try:  # check before opening, so a FIFO or a device is never opened
        st = os.lstat(path)
        if not stat.S_ISREG(st.st_mode) or st.st_size != 0:
            die(f"{path} exists and is not an empty lock file; refusing to touch it (pass another --lock path)")
    except FileNotFoundError:
        pass
    try:
        try:
            fd = os.open(path, flags | os.O_RDWR, 0o666)
        except PermissionError:
            fd = os.open(path, (flags & ~os.O_CREAT) | os.O_RDONLY)  # a lock file created by another user
    except OSError as e:
        die(f"cannot open {path}: {e}")
    st = os.fstat(fd)
    if not stat.S_ISREG(st.st_mode) or st.st_size != 0:
        os.close(fd)
        die(f"{path} exists and is not an empty lock file; refusing to touch it (pass another --lock path)")
    return fd


def try_lock(fd):
    try:
        if os.name == "nt":
            import msvcrt

            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError:
        return False


def resolve(name):
    exe = shutil.which(name)
    if exe is None:
        die(f"command not found: {name}", 127)
    if os.name == "nt" and not os.path.dirname(name):
        # Windows also searches the current folder first; only accept a bare name found on PATH
        if os.path.normcase(os.path.dirname(os.path.abspath(exe))) == os.path.normcase(os.getcwd()):
            die(f"{name} resolved to the current folder ({exe}); pass a full path if you really mean it")
    return exe


_JOB = None  # keep the job handle open for the life of this wrapper


def tie_children_to_wrapper():
    """Windows: a child does not inherit the msvcrt lock, so if this wrapper were killed the lock would be released
    while the render kept running. Put the wrapper in a job object that kills every process in it when its last
    handle closes (KILL_ON_JOB_CLOSE): children join the job automatically, so killing the wrapper ends the render
    too, and the lock is never free while a render is still on the GPU."""
    global _JOB
    import ctypes
    from ctypes import wintypes

    class BASIC(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                    ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                    ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                    ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

    class EXTENDED(ctypes.Structure):
        _fields_ = [("BasicLimitInformation", BASIC), ("IoInfo", ctypes.c_uint64 * 6),
                    ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                    ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateJobObjectW.restype = wintypes.HANDLE
    k32.GetCurrentProcess.restype = wintypes.HANDLE
    job = k32.CreateJobObjectW(None, None)
    info = EXTENDED()
    info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not job or not k32.SetInformationJobObject(wintypes.HANDLE(job), 9, ctypes.byref(info), ctypes.sizeof(info)) \
            or not k32.AssignProcessToJobObject(wintypes.HANDLE(job), wintypes.HANDLE(k32.GetCurrentProcess())):
        die(f"cannot create a job object (error {ctypes.get_last_error()}); refusing to run without it", 2)
    _JOB = job


def main():
    if "--" not in sys.argv:
        print(__doc__)
        sys.exit(2)
    i = sys.argv.index("--")
    ap = argparse.ArgumentParser()
    ap.add_argument("--lock", default=os.path.join(tempfile.gettempdir(), "remotion-gpu.lock"))
    ap.add_argument("--wait", type=float, default=-1, help="max seconds to wait (default: forever)")
    ap.add_argument("--poll", type=float, default=2.0, help="seconds between tries")
    a = ap.parse_args(sys.argv[1:i])
    cmd = sys.argv[i + 1:]
    if not cmd:
        die("no command given")
    exe = resolve(cmd[0])
    if os.name == "nt" and exe.lower().endswith((".cmd", ".bat")):
        # Windows runs .cmd/.bat shims through cmd.exe, which would interpret these characters
        bad = [x for x in [exe] + cmd[1:] if any(c in x for c in '&|<>^%!"\r\n')]
        if bad:
            die(f"refusing to pass shell characters through {os.path.basename(exe)}: {bad}")

    fd = open_lock(a.lock)
    t0 = time.time()
    said = False
    while not try_lock(fd):
        if not said:
            print("[gpu_lock] waiting: another render holds the GPU", file=sys.stderr)
            said = True
        if a.wait >= 0 and time.time() - t0 > a.wait:
            os.close(fd)
            die("timed out waiting for the lock", 75)
        time.sleep(max(0.1, a.poll))
    if os.name == "nt":
        tie_children_to_wrapper()
    try:
        # on macOS/Linux the render inherits the lock, so it stays held even if this wrapper is killed;
        # on Windows the job object ends the render together with the wrapper
        rc = subprocess.call([exe] + cmd[1:], pass_fds=(fd,) if os.name != "nt" else ())
    except KeyboardInterrupt:
        rc = 130
    finally:
        if os.name == "nt":
            import msvcrt

            try:
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
            except OSError:
                pass
        os.close(fd)  # closing the file releases the lock; the empty file stays for the next run
    sys.exit(rc)


if __name__ == "__main__":
    main()
