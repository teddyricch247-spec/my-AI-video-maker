"""The OpenRouter client against a local scripted server: retries, error typing, cost accounting, catalogue cache, secrecy."""
import json
import logging
import time

import pytest
from conftest import run
from fake_server import FakeOpenRouter, Reply, chat_ok, tool_call

from vbeat_agent.config import Settings
from vbeat_agent.llm_types import (LLMAuthError, LLMBadRequest, LLMRateLimited, LLMUnavailable, ModelNotSupported)
from vbeat_agent.openrouter import OpenRouterClient

KEY = "sk-or-v1-" + "a1b2c3d4" * 6
MSGS = [{"role": "system", "content": "s"}, {"role": "user", "content": "u", "_meta": {"summary": "x"}}]
TOOLS = [{"type": "function", "function": {"name": "t", "description": "d", "parameters": {"type": "object", "properties": {}}}}]


@pytest.fixture
def srv():
    with FakeOpenRouter() as s:
        yield s


def make(srv, tmp_path, *, sleeps=None, **kw):
    st = Settings(api_key=KEY, base_url=srv.base_url, cache_dir=tmp_path / "cache", max_attempts=kw.pop("max_attempts", 3), request_timeout=kw.pop("request_timeout", 5.0), **kw)
    rec = sleeps if sleeps is not None else []

    async def fake_sleep(s):
        rec.append(s)
    return OpenRouterClient(st, sleep=fake_sleep), rec


def chat(c, **kw):
    return run(c.chat(model="test/model", messages=MSGS, tools=TOOLS, temperature=0.3, max_tokens=500, **kw))


def test_happy_path_with_tool_call_and_api_cost(srv, tmp_path):
    srv.queue("/chat/completions", Reply(200, chat_ok(None, tool_calls=[tool_call("write_scene", {"source": "x"})])))
    c, _ = make(srv, tmp_path)
    r = chat(c)
    assert r.tool_calls[0].name == "write_scene" and r.tool_calls[0].arguments == {"source": "x"}
    assert r.usage.cost_usd == 0.002 and r.usage.cost_source == "api" and r.attempts == 1 and r.request_id == "gen-123"
    assert r.message["content"] is None and r.message["tool_calls"][0]["function"]["name"] == "write_scene"
    req = srv.requests[0]
    assert req["headers"]["authorization"] == f"Bearer {KEY}" and req["headers"]["x-title"] == "vbeat"
    j = req["json"]
    assert j["model"] == "test/model" and j["tools"] == TOOLS and j["tool_choice"] == "auto" and j["usage"] == {"include": True}
    assert j["provider"] == {"require_parameters": True} and j["temperature"] == 0.3 and j["max_tokens"] == 500
    assert all("_meta" not in m for m in j["messages"])                      # internal keys never go over the wire


def test_provider_and_fallback_models_pass_through(srv, tmp_path):
    srv.queue("/chat/completions", Reply(200, chat_ok()))
    c, _ = make(srv, tmp_path, provider={"order": ["Anthropic"]}, models_fallback=["a/b", "c/d"], send_usage_flag=False)
    chat(c)
    j = srv.requests[0]["json"]
    assert j["provider"] == {"order": ["Anthropic"]} and j["models"] == ["a/b", "c/d"] and "usage" not in j


def test_cost_from_catalogue_when_api_gives_none_and_unknown_otherwise(srv, tmp_path):
    srv.queue("/models", Reply(200, {"data": [{"id": "test/model", "name": "T", "pricing": {"prompt": "0.000001", "completion": "0.000004"},
                                              "supported_parameters": ["tools"], "architecture": {"input_modalities": ["text", "image"]}, "context_length": 1000}]}))
    srv.queue("/chat/completions", Reply(200, chat_ok(cost=None, prompt=1000, completion=500)), Reply(200, chat_ok(cost=None, prompt=0, completion=0)))
    c, _ = make(srv, tmp_path)
    info = run(c.model_info("test/model"))
    assert info.supports_tools and info.supports_images and info.price_in == 1.0 and info.price_out == 4.0
    r = chat(c)
    assert r.usage.cost_source == "catalogue" and r.usage.cost_usd == pytest.approx(0.001 + 0.002)
    c2, _ = make(srv, tmp_path / "other")                                    # no catalogue loaded, no api cost -> unknown
    srv.queue("/chat/completions", Reply(200, chat_ok(cost=None)))
    r2 = chat(c2)
    assert r2.usage.unknown_cost and r2.usage.budget_cost() == 0.05


def test_rate_limit_retried_honouring_retry_after(srv, tmp_path):
    srv.queue("/chat/completions", Reply(429, {"error": {"message": "slow down"}}, headers={"Retry-After": "7"}), Reply(200, chat_ok()))
    c, sleeps = make(srv, tmp_path)
    r = chat(c)
    assert r.attempts == 2 and sleeps == [7.0] and srv.count("/chat/completions") == 2


def test_retry_after_is_capped(srv, tmp_path):
    srv.queue("/chat/completions", Reply(429, {"error": {"message": "x"}}, headers={"Retry-After": "9999"}), Reply(200, chat_ok()))
    c, sleeps = make(srv, tmp_path)
    chat(c)
    assert sleeps == [60.0]


def test_server_errors_back_off_then_give_up_with_status_in_message(srv, tmp_path):
    srv.queue("/chat/completions", Reply(503, {"error": {"message": "upstream down"}}))
    c, sleeps = make(srv, tmp_path, max_attempts=3)
    with pytest.raises(LLMUnavailable) as ei:
        chat(c)
    assert "HTTP 503" in str(ei.value) and "upstream down" in str(ei.value)
    assert srv.count("/chat/completions") == 3 and len(sleeps) == 2 and sleeps[1] > sleeps[0] * 0.9    # exponential, jittered


def test_429_after_all_attempts_is_rate_limited(srv, tmp_path):
    srv.queue("/chat/completions", Reply(429, {"error": {"message": "limit"}}))
    c, _ = make(srv, tmp_path, max_attempts=2)
    with pytest.raises(LLMRateLimited):
        chat(c)


@pytest.mark.parametrize("status", [401, 402, 403])
def test_auth_errors_are_not_retried(srv, tmp_path, status):
    srv.queue("/chat/completions", Reply(status, {"error": {"message": "nope"}}))
    c, sleeps = make(srv, tmp_path)
    with pytest.raises(LLMAuthError) as ei:
        chat(c)
    assert f"HTTP {status}" in str(ei.value) and ei.value.status == status and srv.count("/chat/completions") == 1 and not sleeps


def test_bad_request_carries_the_api_explanation(srv, tmp_path):
    srv.queue("/chat/completions", Reply(400, {"error": {"message": "invalid model id", "metadata": {"provider_name": "P", "raw": "detail here"}}}))
    c, _ = make(srv, tmp_path)
    with pytest.raises(LLMBadRequest) as ei:
        chat(c)
    assert "HTTP 400" in str(ei.value) and "invalid model id" in str(ei.value) and "detail here" in str(ei.value) and srv.count("/chat/completions") == 1


def test_no_tool_endpoint_is_model_not_supported(srv, tmp_path):
    srv.queue("/chat/completions", Reply(404, {"error": {"message": "No endpoints found that support tool use. Try disabling `tools`."}}))
    c, _ = make(srv, tmp_path)
    with pytest.raises(ModelNotSupported):
        chat(c)


def test_error_object_inside_a_200_is_retried(srv, tmp_path):
    srv.queue("/chat/completions", Reply(200, {"error": {"code": 502, "message": "provider returned error"}}), Reply(200, chat_ok()))
    c, _ = make(srv, tmp_path)
    assert chat(c).attempts == 2


def test_body_level_auth_error_is_not_retried(srv, tmp_path):
    srv.queue("/chat/completions", Reply(200, {"error": {"code": 402, "message": "insufficient credits"}}))
    c, _ = make(srv, tmp_path)
    with pytest.raises(LLMAuthError):
        chat(c)
    assert srv.count("/chat/completions") == 1


@pytest.mark.parametrize("reply", [Reply(200, raw=b"<html>gateway</html>"), Reply(200, {"choices": []}), Reply(200, raw=b"")])
def test_garbage_and_empty_choices_are_retried(srv, tmp_path, reply):
    srv.queue("/chat/completions", reply, Reply(200, chat_ok()))
    c, _ = make(srv, tmp_path)
    assert chat(c).attempts == 2


def test_malformed_tool_arguments_are_flagged_not_raised(srv, tmp_path):
    srv.queue("/chat/completions", Reply(200, chat_ok(None, tool_calls=[tool_call("write_scene", '{"source": "abc')], finish="length")))
    c, _ = make(srv, tmp_path)
    r = chat(c)
    assert r.tool_calls[0].invalid_arguments and "cut off at the output limit" in r.tool_calls[0].error and r.finish_reason == "length"
    assert r.message["tool_calls"][0]["function"]["arguments"] == '{"source": "abc'      # echoed unchanged so the transcript stays truthful


def test_reasoning_details_are_handed_back(srv, tmp_path):
    body = chat_ok("ok")
    body["choices"][0]["message"]["reasoning_details"] = [{"type": "reasoning.text", "text": "hmm"}]
    srv.queue("/chat/completions", Reply(200, body))
    c, _ = make(srv, tmp_path)
    assert chat(c).message["reasoning_details"][0]["text"] == "hmm"


def test_connection_refused_is_unavailable_and_retried(tmp_path):
    with FakeOpenRouter() as s:
        dead = s.base_url
    st = Settings(api_key=KEY, base_url=dead, cache_dir=tmp_path, max_attempts=2, request_timeout=2.0)
    sleeps: list = []

    async def sl(x):
        sleeps.append(x)
    c = OpenRouterClient(st, sleep=sl)
    with pytest.raises(LLMUnavailable) as ei:
        chat(c)
    assert "could not reach" in str(ei.value) and len(sleeps) == 1


def test_timeout_is_unavailable(srv, tmp_path):
    srv.queue("/chat/completions", Reply(200, chat_ok(), delay=1.5))
    c, _ = make(srv, tmp_path, max_attempts=1, request_timeout=0.3)
    with pytest.raises(LLMUnavailable) as ei:
        chat(c)
    assert "no answer within" in str(ei.value) or "could not reach" in str(ei.value)


def test_no_key_is_an_auth_error_without_a_request(srv, tmp_path):
    st = Settings(api_key=None, base_url=srv.base_url, cache_dir=tmp_path)
    with pytest.raises(LLMAuthError):
        chat(OpenRouterClient(st))
    assert not srv.requests


def test_catalogue_is_cached_on_disk_and_stale_cache_survives_an_outage(srv, tmp_path):
    srv.queue("/models", Reply(200, {"data": [{"id": "a/b", "supported_parameters": ["tools"]}, {"id": "c/d", "supported_parameters": ["temperature"]}]}))
    c, _ = make(srv, tmp_path)
    ms = run(c.list_models())
    assert {m.id: m.supports_tools for m in ms} == {"a/b": True, "c/d": False}
    c2, _ = make(srv, tmp_path)
    run(c2.list_models())
    assert srv.count("/models") == 1                                                    # second client used the cache
    assert "authorization" not in srv.requests[0]["headers"]                             # the public endpoint never sees the key
    cache = tmp_path / "cache" / "openrouter-models.json"
    doc = json.loads(cache.read_text())
    doc["fetched_at"] -= 48 * 3600                                                       # make it stale
    cache.write_text(json.dumps(doc))
    srv.queue("/models", Reply(500, {"error": {"message": "down"}}))
    c3, _ = make(srv, tmp_path)
    assert {m.id for m in run(c3.list_models())} == {"a/b", "c/d"}                       # stale beats nothing
    assert run(c3.model_info("zzz/none")) is None


def test_model_info_is_none_when_catalogue_unreachable_and_uncached(srv, tmp_path):
    srv.queue("/models", Reply(500, {"error": {"message": "down"}}))
    c, _ = make(srv, tmp_path)
    assert run(c.model_info("a/b")) is None


def test_key_status_returns_numbers_only(srv, tmp_path):
    srv.queue("/key", Reply(200, {"data": {"label": f"{KEY[:12]}...{KEY[-3:]}", "limit": 20, "usage": 4.5, "limit_remaining": 15.5, "is_free_tier": False}}))
    c, _ = make(srv, tmp_path)
    st = run(c.key_status())
    assert st == {"limit": 20.0, "usage": 4.5, "limit_remaining": 15.5, "is_free_tier": False} and "label" not in st
    srv.queue("/key", Reply(401, {"error": {"message": "No auth credentials found"}}))
    with pytest.raises(LLMAuthError):
        run(c.key_status())


def test_the_key_never_reaches_logs_or_error_messages(srv, tmp_path, caplog):
    caplog.set_level(logging.INFO, logger="vbeat_agent")
    srv.queue("/chat/completions", Reply(401, {"error": {"message": f"bad key {KEY}"}}))
    c, _ = make(srv, tmp_path)
    with pytest.raises(LLMAuthError) as ei:
        chat(c)
    srv.queue("/chat/completions", Reply(200, chat_ok()))
    chat(c)
    assert KEY not in str(ei.value) and KEY not in caplog.text and "REDACTED" in str(ei.value)
    assert "openrouter_call" in caplog.text and "sk-or-v1" not in caplog.text
    assert KEY not in repr(c.s) and KEY not in str(vars(c).get("s"))


def test_concurrent_calls_do_not_block_each_other(srv, tmp_path):
    import asyncio
    srv.queue("/chat/completions", Reply(200, chat_ok(), delay=0.5))
    c, _ = make(srv, tmp_path)

    async def go():
        t0 = time.monotonic()
        await asyncio.gather(*[c.chat(model="m", messages=MSGS, tools=TOOLS) for _ in range(6)])
        return time.monotonic() - t0
    assert run(go()) < 2.0                                                                # 6 x 0.5 s in parallel, not serial (3 s)
