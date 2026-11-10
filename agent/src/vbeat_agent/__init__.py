"""vbeat agent runner: one LLM-driven loop per beat (docs/CONTRACTS.md section 13, agent/docs/EVENTS.md)."""
from __future__ import annotations

__version__ = "0.1.0"

# The public interface the backend calls. Imports are lazy so `import vbeat_agent` stays cheap and cannot fail on a
# missing optional dependency.
__all__ = ["BeatRequest", "BeatResult", "Caps", "run_beat", "continue_beat", "revert_beat", "run_beats",
           "EventSink", "FileEventSink", "CallbackSink", "events_to_messages",
           "preflight", "selftest", "diagnose", "explain", "preflight_async", "selftest_async", "load_settings", "Settings", "kill_switch_engage", "kill_switch_release",
           "kill_switch_engaged", "SpendLedger", "Mirror", "rebuild_beat_dir", "read_version_bundle"]


def __getattr__(name: str):
    if name in ("BeatRequest", "BeatResult", "run_beat", "continue_beat", "revert_beat"):
        from . import beat
        return getattr(beat, name)
    if name == "Caps":
        from . import config
        return config.Caps
    if name == "run_beats":
        from . import runner
        return runner.run_beats
    if name in ("EventSink", "FileEventSink", "CallbackSink", "events_to_messages"):
        from . import events
        return getattr(events, name)
    if name in ("preflight", "selftest", "diagnose", "explain", "preflight_async", "selftest_async"):
        from . import health
        return getattr(health, name)
    if name in ("load_settings", "Settings"):
        from . import config
        return getattr(config, name)
    if name in ("kill_switch_engage", "kill_switch_release", "kill_switch_engaged"):
        from . import killswitch
        return {"kill_switch_engage": killswitch.engage, "kill_switch_release": killswitch.release, "kill_switch_engaged": killswitch.engaged}[name]
    if name == "explain":
        from . import errors
        return errors.explain
    if name == "Mirror":
        from . import mirror
        return mirror.Mirror
    if name in ("rebuild_beat_dir", "read_version_bundle"):
        from . import hydrate
        return getattr(hydrate, name)
    if name == "SpendLedger":
        from . import budget
        return budget.SpendLedger
    raise AttributeError(name)
