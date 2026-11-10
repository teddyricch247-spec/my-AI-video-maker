"""The one list of sound-effect marker kinds (docs/CONTRACTS.md section 4).

The browser runtime (engine/runtime/runtime.js), the audio package (audio/src/vbeat_audio/constants.py) and the asset
checker (motion-assets/tools/check.py) cannot import this file, so each keeps a literal copy.
integration/test_seams.py compares every copy with MARKER_KINDS and fails when one drifts.
"""
from __future__ import annotations

MARKER_KINDS = ("pop", "tick", "whoosh", "thud", "stamp", "slide", "chime", "rustle")


def is_marker_kind(kind: object) -> bool:
    return isinstance(kind, str) and kind in MARKER_KINDS
