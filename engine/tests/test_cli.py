import json
import os
import subprocess
import sys

from helpers import ASSETS, ROOT, SCENES, TRANSCRIPTS, good_scene, write_spec

ENV = {**os.environ, "PYTHONPATH": os.pathsep.join([str(ROOT / "src"), str(ROOT.parent / "shared" / "src")]), "PYTHONDONTWRITEBYTECODE": "1"}


def cli(*args):
    p = subprocess.run([sys.executable, "-m", "vbeat_sprite", *map(str, args)], capture_output=True, text=True, env=ENV, cwd=ROOT)
    lines = [ln for ln in p.stdout.splitlines() if ln.strip()]
    assert len(lines) == 1, f"stdout must be exactly one JSON line, got {p.stdout!r} (stderr: {p.stderr[-400:]})"
    env = json.loads(lines[0])
    assert set(env) == {"ok", "command", "artifacts", "report", "timing_ms", "error"}
    return p.returncode, env


def test_full_pipeline_spec_strip_check_video(tmp_path):
    rc, e = cli("ingest", "--transcript", TRANSCRIPTS / "native.json", "--fps", 30, "--out", tmp_path / "i")
    assert rc == 0 and e["ok"] and e["command"] == "ingest" and e["report"]["words"] == 10

    rc, e = cli("spec", "--transcript", TRANSCRIPTS / "native.json", "--fps", 30, "--from-word", "w0001", "--to-word", 3,
                "--scene", good_scene(), "--assets", ASSETS, "--width", 1280, "--height", 720, "--idx", 2, "--out", tmp_path / "s")
    assert rc == 0 and e["ok"], e
    spec = e["artifacts"]["spec"]
    beat = e["report"]["beat"]
    assert beat["f0"] == 0 and beat["f1"] == (339 + 360) // 2          # first beat starts at 0; cut = midpoint of the pause (f1 of "fox." / f0 of "It")

    rc, e = cli("strip", "--spec", spec, "--out", tmp_path / "strip")
    assert rc == 0 and e["ok"] and (tmp_path / "strip" / "strip.jpg").is_file()

    rc, e = cli("check", "--spec", spec, "--level", "full", "--out", tmp_path / "chk")
    assert rc == 0 and e["ok"] and e["report"]["ok"] and e["report"]["text"] == "OK: no findings", e

    rc, e = cli("markers", "--spec", spec, "--out", tmp_path / "m")
    assert rc == 0 and e["report"]["markers"][0]["kind"] == "pop"

    rc, e = cli("frames", "--spec", spec, "--times", "0.5,1.5", "--size", "960x540", "--out", tmp_path / "f")
    assert rc == 0 and len(e["artifacts"]) == 2

    rc, e = cli("video", "--spec", spec, "--out", tmp_path / "v", "--preset", "ultrafast")
    assert rc == 0 and e["ok"], e
    v = e["report"]["verification"]
    assert v["codec"] == "h264" and v["frames"] == beat["f1"] - beat["f0"] and (v["width"], v["height"]) == (1280, 720)
    assert (tmp_path / "v" / "video.mp4").is_file()


def test_failing_check_is_ok_true_with_report_false(tmp_path):
    spec = write_spec(tmp_path, SCENES / "c4_offcanvas.js")
    rc, e = cli("check", "--spec", spec, "--level", "full", "--out", tmp_path / "c")
    assert rc == 0 and e["ok"] is True and e["report"]["ok"] is False and e["error"] is None
    assert "C4 error" in e["report"]["text"]


def test_scene_fault_is_ok_false_exit_0_tool_error_exit_1(tmp_path):
    spec = write_spec(tmp_path, SCENES / "c3_throw.js")
    rc, e = cli("frames", "--spec", spec, "--times", "2.0", "--out", tmp_path / "f")
    assert rc == 0 and e["ok"] is False and e["error"]["type"] == "SceneError" and e["error"]["t"] == 2.0
    rc, e = cli("strip", "--spec", tmp_path / "missing.json", "--out", tmp_path / "x")
    assert rc == 1 and e["ok"] is False and e["error"]["type"] == "SpecError"
    rc, e = cli("frames", "--spec", write_spec(tmp_path, good_scene(), name="ok.json"), "--times", "99", "--out", tmp_path / "y")
    assert rc == 1 and e["error"]["type"] == "ValueError"


def test_usage_errors_still_print_one_json_object(tmp_path):
    rc, e = cli("frames", "--out", tmp_path)                # missing --spec / --times
    assert rc == 2 and e["ok"] is False and e["error"]["type"] == "UsageError"
    rc, e = cli("nonsense", "--out", tmp_path)
    assert rc == 2 and e["error"]["type"] == "UsageError"


def test_spec_with_unusable_range(tmp_path):
    rc, e = cli("spec", "--transcript", TRANSCRIPTS / "native.json", "--fps", 30, "--from-word", 7, "--to-word", 3,
                "--scene", good_scene(), "--assets", ASSETS, "--out", tmp_path / "s")
    assert rc == 1 and e["error"]["type"] == "TimelineError"


def test_help_prints_usage_and_exits_zero():
    for args in (["--help"], ["strip", "--help"]):
        p = subprocess.run([sys.executable, "-m", "vbeat_sprite", *args], capture_output=True, text=True, env=ENV, cwd=ROOT)
        assert p.returncode == 0 and p.stdout.startswith("usage:") and '"ok"' not in p.stdout


def test_bench_leaves_only_bench_json(tmp_path):
    rc, e = cli("bench", "--frames", 6, "--out", tmp_path / "b")
    assert rc == 0 and e["ok"] and [p.name for p in (tmp_path / "b").iterdir()] == ["bench.json"]
    assert e["report"]["ms_per_frame"]["encode"] > 0


def test_commands_in_interfaces_md_run_end_to_end(tmp_path):
    """Executes the documented command block verbatim (optional [..] flags dropped, --out redirected)."""
    import re
    import shlex
    text = (ROOT / "docs" / "INTERFACES.md").read_text()
    block = text.split("```")[1]
    joined = re.sub(r"\\\n\s*", " ", block)
    lines = [ln for ln in joined.splitlines() if ln.strip().startswith("python -m vbeat_sprite")]
    assert len(lines) == 8
    seen = []
    for ln in lines:
        ln = re.sub(r"\[[^\]]*\]", "", ln)
        argv = shlex.split(ln, comments=True)[3:]
        argv = [str(tmp_path / a) if a.startswith("out/") else a for a in argv]
        if argv[0] == "bench":
            argv += ["--frames", "6"]
        if argv[0] == "video":
            argv += ["--preset", "ultrafast"]
        rc, e = cli(*argv)
        assert rc == 0 and e["ok"], (ln, e["error"])
        seen.append(e["command"])
    assert seen == ["ingest", "spec", "strip", "frames", "check", "markers", "video", "bench"]
