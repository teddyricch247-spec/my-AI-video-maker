import pytest

from vbeat_shared.envelope import (CHECK_ID_PREFIXES, Outcome, check_projection, classify, error_obj, make_envelope,
                                   validate_check_report, validate_envelope)


def test_make_envelope_is_valid_and_has_exactly_the_contract_keys():
    e = make_envelope("spec", artifacts={"spec": "/x/spec.json"}, timing_ms={"total": 3})
    assert validate_envelope(e) == [] and list(e) == ["ok", "command", "artifacts", "report", "timing_ms", "error"]
    bad = make_envelope("spec", ok=False, error=error_obj("UsageError", "nope"))
    assert validate_envelope(bad) == []


@pytest.mark.parametrize("mutate", [
    lambda e: e.pop("report"), lambda e: e.update(extra=1), lambda e: e.update(ok="yes"), lambda e: e.update(error={"type": "T", "message": "m"}),
    lambda e: e.update(artifacts={"a": 1}), lambda e: e.update(command=""),
])
def test_validate_envelope_rejects_malformed_envelopes(mutate):
    e = make_envelope("spec")
    mutate(e)
    assert validate_envelope(e)


def test_a_failed_envelope_needs_an_error_object():
    e = make_envelope("spec", ok=False)
    assert validate_envelope(e)


def test_classify_reads_the_envelope_not_the_exit_code():
    assert classify(make_envelope("x")) is Outcome.PASS
    assert classify(make_envelope("x", report={"ok": True})) is Outcome.PASS
    assert classify(make_envelope("x", report={"ok": False})) is Outcome.REPORT_FAILED
    assert classify(make_envelope("x", ok=False, error=error_obj("SceneError", "m"))) is Outcome.CONTENT_FAULT
    assert classify(make_envelope("x", ok=False, error=error_obj("UsageError", "m"))) is Outcome.TOOL_FAILED


def good_report():
    return {"ok": False, "counts": {"error": 1, "warn": 1}, "text": "t",
            "findings": [{"id": "C3", "severity": "error", "message": "m"}, {"id": "A5", "severity": "warn", "message": "m"}]}


def test_check_report_validation():
    assert validate_check_report(good_report()) == []
    r = good_report(); r["findings"][0]["severity"] = "fatal"
    assert validate_check_report(r)
    r = good_report(); r["findings"][0]["id"] = "X1"
    assert validate_check_report(r)
    r = good_report(); r["ok"] = True
    assert validate_check_report(r)
    r = good_report(); r["counts"]["warn"] = 0
    assert validate_check_report(r)
    assert set(CHECK_ID_PREFIXES) == {"C", "A"}


def test_check_projection_is_the_web_apis_check_object():
    assert check_projection(good_report()) == {"ok": False, "counts": {"error": 1, "warn": 1}, "text": "t"}
