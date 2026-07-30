from benchmarks.llm_usage_audit import run


def test_audit_is_offline_and_tracks_route_reasons(tmp_path):
    data = run(tmp_path)

    assert data["mode"] == "offline-no-network"
    assert (tmp_path / "LLM_USAGE_AUDIT.md").exists()
    assert (tmp_path / "model_calls.json").exists()
    assert all(call["reason"] for call in data["calls"])

    outcomes = {row["scenario"]: row for row in data["scenario_outcomes"]}
    assert outcomes["short_standard"]["model_calls"] == 2
    assert outcomes["doctrinal"]["model_calls"] == 2
    assert outcomes["low_model_confidence_theoretical"]["model_calls"] == 4
    assert outcomes["tm_exact"]["model_calls"] == 0
    assert outcomes["sacred_canonical_hit"]["model_calls"] == 0
    assert outcomes["sacred_canonical_miss"]["model_calls"] == 0


def test_every_paid_estimate_names_model_stage_and_operation(tmp_path):
    data = run(tmp_path)
    for call in data["calls"]:
        assert call["model"]
        assert call["stage"]
        assert call["operation"]
        assert call["source"]


def test_controlled_optimizations_reduce_estimated_prompt_tokens(tmp_path):
    data = run(tmp_path)
    rows = {row["configuration"]: row for row in data["optimization_benchmarks"]}

    current = rows["current: 12-term glossary + draft/refine"]
    filtered = rows["filter glossary + draft/refine"]
    single = rows["12-term glossary + draft only"]
    combined = rows["filter glossary + draft only"]
    large = rows["future 100-term glossary + draft/refine"]

    assert filtered["estimated_prompt_tokens"] < current["estimated_prompt_tokens"]
    assert single["estimated_prompt_tokens"] < current["estimated_prompt_tokens"]
    assert combined["estimated_prompt_tokens"] < filtered["estimated_prompt_tokens"]
    assert large["estimated_prompt_tokens"] > current["estimated_prompt_tokens"]
