"""Plain-language errors: every way a run can stop or a check can fail is explained as WHAT happened, WHY, and WHAT TO DO.

The machine reasons (`cap:max_usd`, `llm_auth`, ...) stay stable for code; `explain(reason, detail)` turns them into text a person
who has no shell and no terminal can act on. Shown in `BeatResult.explanation`, in `status` events and by `diagnose()`.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from .redact import redact


@dataclass(frozen=True)
class Explained:
    code: str
    what: str
    why: str
    fix: str

    def to_dict(self) -> dict[str, str]:
        return {k: redact(v) for k, v in asdict(self).items()}

    def text(self) -> str:
        return f"What happened: {self.what}\nWhy: {self.why}\nWhat to do: {self.fix}"


def _e(code: str, what: str, why: str, fix: str) -> Explained:
    return Explained(code, what, why, fix)


def explain(reason: str | None, detail: str = "", **ctx: Any) -> Explained | None:
    """Explain a BeatResult.status_reason (or a preflight problem code). None for a normal finish."""
    r = reason or ""
    d = (detail or "").strip()
    if r in ("", "finished"):
        return None
    status = ctx.get("http_status")
    if r == "ask_user":
        return _e(r, "The agent paused because it has a question for you.", d or "It could not decide something about this beat.",
                  "Answer it (continue with your answer as the message). Or tell it to decide for itself.")
    if r == "give_up":
        return _e(r, "The agent gave up on this beat.", d or "It judged it could not make progress.",
                  "Read its reason, then continue with more specific guidance (what to show, which asset to use), or revert to an earlier version.")
    if r.startswith("checks_failed"):
        return _e(r, "The beat still has failing checks.", f"The last report listed: {r.split(':', 1)[-1]}.",
                  "Continue with a hint about those findings, or revert to a version that passed.")
    caps = {
        "cap:max_steps": ("The agent used all of its allowed steps.", "Each model turn is a step and the limit for one run was reached.",
                          "Continue the beat (it keeps its work), or raise max_steps if the beat is complex."),
        "cap:max_minutes": ("The run hit its time limit.", "It took longer than the allowed minutes for one run.",
                            "Continue the beat; slow tools or a slow model are the usual cause (see diagnose)."),
        "cap:max_usd": ("The beat stopped at its spending limit.", "The model calls in this run reached the per-beat cap.",
                        "Look at what it produced. If it is close, continue the beat with a raised cap; if it is going in circles, give it a clearer direction."),
        "cap:total_max_usd": ("The whole batch stopped at its spending limit.", "The beats in this run together reached the per-run cap.",
                              "Raise the per-run cap and continue the unfinished beats, or accept the finished ones."),
        "cap:daily_usd": ("Today's spending limit was reached, so nothing more was started.", "All runs on this machine share one daily cap.",
                          "Wait for tomorrow (UTC unless a ledger timezone is set), or raise the daily cap if you really intend to spend more."),
        "cap:max_tool_errors_in_a_row": ("The agent kept failing the same way.", "Several tool calls in a row were rejected or failed their checks.",
                                         "Open diagnose for the last findings, then continue with a hint, or revert to a version that passed."),
        "cap:context": ("The conversation grew too large to continue.", "Even after trimming old results, it exceeded the model's working budget.",
                        "Revert to the last good version and continue with a short, specific instruction."),
        "no_tool_call": ("The model stopped using tools.", "It answered in plain text three times after being told to call a tool.",
                         "Continue with a short instruction. If it keeps happening, switch to a model that follows tool instructions better."),
        "stuck": ("The agent was repeating itself.", "It made the same moves with the same results several times.",
                  "Continue with a different direction, or revert to an earlier version."),
    }
    if r in caps:
        return _e(r, *caps[r])
    if r == "llm_auth":
        if status == 402 or "402" in d:
            return _e(r, "OpenRouter refused the request: out of credits.", "The account behind the key has no balance left (error 402).",
                      "Add credits at openrouter.ai/credits, then continue the beat. Nothing was lost.")
        if status == 403 or "403" in d:
            return _e(r, "OpenRouter refused the request: this key is not allowed to do that.", "The key, the model or your region is restricted (error 403).",
                      "Check the key's settings and the model's access rules on openrouter.ai, or choose another model.")
        return _e(r, "OpenRouter rejected the API key.", "The key is missing, mistyped, revoked or expired (error 401).",
                  "Create a new key on openrouter.ai/keys, set it as OPENROUTER_API_KEY on the hosted system, restart, and run preflight.")
    if r == "llm_unavailable":
        return _e(r, "The model service did not answer.", d or "It was busy or unreachable after several retries (rate limit or outage).",
                  "Continue the beat in a few minutes. If it repeats, try another model or a provider preference.")
    if r == "llm_bad_request":
        return _e(r, "OpenRouter rejected the request as invalid.", d or "The model id or a setting is not accepted.",
                  "Check the model id with the models list; make sure it supports tool calling.")
    if r == "model_not_supported":
        return _e(r, "This model cannot be used for beats.", d or "It does not support tool calling.",
                  "Pick a model marked as supporting tools in the models list.")
    if r == "llm_error":
        return _e(r, "The model client failed unexpectedly.", d or "An internal error occurred while talking to the model.",
                  "Run diagnose and send its output along with the beat's agent/transcript.md.")
    if r.startswith("tool_fault"):
        tool = r.split(":", 1)[-1]
        return _e(r, f"A rendering tool broke while running '{tool}'.", d or "Chromium, ffmpeg or a subprocess crashed or timed out twice. This is the machine, not the model.",
                  "Run selftest to see whether the machine is healthy (memory, disk, Chromium). Then continue the beat.")
    if r in ("kill_switch", "cancel_file", "sigterm", "cancel_event") or r.startswith("cancel"):
        if r == "kill_switch":
            return _e(r, "The kill switch is on, so the run was stopped.", "Someone engaged it (or VBEAT_KILL is set) to halt all spending and rendering.",
                      "Release the kill switch when you want to run again; the beat keeps its work and can be continued.")
        return _e(r, "The run was cancelled.", d or "A cancel request arrived (or the machine was paused).", "Continue the beat when you are ready; it resumes where it stopped.")
    if r.startswith("bootstrap"):
        return _e(r, "The beat could not be prepared.", d or "The transcript or the word range was not usable.",
                  "Check the transcript file and that from_word / to_word exist in it, then start the beat again.")
    if r == "internal_error":
        return _e(r, "The runner hit an internal error.", d or "A bug or an unexpected condition on this machine.",
                  "Run diagnose on this beat and send its output; the traceback is in agent/transcript.md. The beat's files are intact and it can be continued.")
    if r == "busy":
        return _e(r, "This beat is already running.", "Another process holds its lock.", "Wait for it to finish, or cancel it first.")
    if r == "no_api_key":
        return _e(r, "No OpenRouter key is configured.", "OPENROUTER_API_KEY is not set in this process's environment.",
                  "Add the key as a secret named OPENROUTER_API_KEY on the hosted system (never in a file), restart it, and run preflight.")
    if r == "daily_limit_reached":
        return explain("cap:daily_usd")
    return _e(r, f"The run stopped: {r}.", d or "No further detail was recorded.", "Run diagnose on this beat for the transcript and costs.")
