"""Generate a zero-network audit of every LLM path in Haydari.

This harness deliberately does not import credentials, call providers, mutate the
database, or deploy anything. It executes the real translation router with probe
adapters and writes a per-call JSON ledger plus a human-readable Markdown report.

Run from the repository root::

    python -m benchmarks.llm_usage_audit

Token counts are tokenizer-independent estimates. Exact tokens and cost are only
available from provider responses; the production adapters already request those,
but production currently aggregates them too coarsely for per-call attribution.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
from typing import Any

from pipeline.ocr.engines import _OCR_PROMPT
from pipeline.translate.core import Pipeline
from pipeline.translate.interfaces import Translator
from pipeline.translate.mocks import MockCanonicalDB
from pipeline.translate.prompt import PromptBuilder
from pipeline.translate.router import Router
from pipeline.translate.types import Context, Prompt, TranslationResult

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = ROOT / "benchmarks" / "results"

# OpenRouter list prices checked 2026-07-30. These are estimates, not billing
# records. Links are emitted in the report so prices can be rechecked later.
MODEL_PRICES: dict[str, tuple[float, float]] = {
    "google/gemini-2.5-flash": (0.30, 2.50),
    "google/gemini-2.5-pro": (1.25, 10.00),
    "google/gemini-2.5-flash-lite": (0.10, 0.40),
}
PRICE_SOURCES = {
    "google/gemini-2.5-flash": "https://openrouter.ai/google/gemini-2.5-flash",
    "google/gemini-2.5-pro": "https://openrouter.ai/google/gemini-2.5-pro",
    "google/gemini-2.5-flash-lite": "https://openrouter.ai/google/gemini-2.5-flash-lite",
}


def estimate_tokens(text: str) -> int:
    """Return a transparent rough estimate, never presented as exact usage.

    A mixed Arabic/English prompt is conservatively approximated at three
    Unicode characters per token. Provider tokenizers and image accounting vary.
    """

    return max(1, math.ceil(len(text) / 3)) if text else 0


def read_model_config() -> dict[str, str]:
    """Read only non-secret model selectors from server/.env and the process."""

    allowed = {
        "CLOUD_TRANSLATOR",
        "TRANSLATION_MODEL_BULK",
        "TRANSLATION_MODEL_FRONTIER",
        "OCR_MODEL",
        "HAYDARI_CHAT_MODEL",
        "HAYDARI_OCR_ENGINE",
    }
    values: dict[str, str] = {}
    env_file = ROOT / "server" / ".env"
    if env_file.exists():
        for raw in env_file.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            if key.strip() in allowed:
                values[key.strip()] = value.strip().strip('"').strip("'")
    for key in allowed:
        if os.environ.get(key):
            values[key] = os.environ[key]
    return {
        "bulk": values.get("TRANSLATION_MODEL_BULK", "google/gemini-2.5-flash"),
        "frontier": values.get("TRANSLATION_MODEL_FRONTIER", "anthropic/claude-sonnet-5"),
        "ocr": values.get("OCR_MODEL", "google/gemini-2.5-flash"),
        "chat": values.get("HAYDARI_CHAT_MODEL", "google/gemini-2.5-flash"),
        "cloud_translator": values.get("CLOUD_TRANSLATOR", "auto"),
        "ocr_engine": values.get("HAYDARI_OCR_ENGINE", "auto"),
    }


@dataclass
class CallRecord:
    scenario: str
    stage: str
    operation: str
    model: str
    tier: str
    reason: str
    source: str
    prompt_chars: int
    estimated_prompt_tokens: int
    completion_chars: int
    estimated_completion_tokens: int
    estimated_cost_usd: float | None
    exact_provider_usage: bool = False
    notes: str = ""


def estimated_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float | None:
    price = MODEL_PRICES.get(model)
    if not price:
        return None
    return round((prompt_tokens * price[0] + completion_tokens * price[1]) / 1_000_000, 8)


class ProbeTranslator(Translator):
    """Offline adapter that records the actual prompts constructed by Pipeline."""

    def __init__(
        self,
        *,
        model: str,
        tier: str,
        scenario: str,
        reason: str,
        ledger: list[CallRecord],
        confidence: float,
        output: str,
    ) -> None:
        self.model = model
        self.name = f"probe:{model}"
        self.tier = tier
        self.scenario = scenario
        self.reason = reason
        self.ledger = ledger
        self.confidence = confidence
        self.output = output

    def _record(self, operation: str, prompt: Prompt) -> TranslationResult:
        rendered = prompt.render()
        output = self.output
        pt = estimate_tokens(rendered)
        ct = estimate_tokens(output)
        self.ledger.append(
            CallRecord(
                scenario=self.scenario,
                stage="translation",
                operation=operation,
                model=self.model,
                tier=self.tier,
                reason=self.reason,
                source="pipeline/translate/core.py",
                prompt_chars=len(rendered),
                estimated_prompt_tokens=pt,
                completion_chars=len(output),
                estimated_completion_tokens=ct,
                estimated_cost_usd=estimated_cost(self.model, pt, ct),
                notes="Prompt is exact; token and cost values are estimates.",
            )
        )
        return TranslationResult(text=output, confidence=self.confidence)

    def translate(self, prompt: Prompt, *, ar: str, context: Context) -> TranslationResult:
        return self._record("draft", prompt)

    def refine(
        self, draft: str, *, prompt: Prompt, ar: str, context: Context
    ) -> TranslationResult:
        return self._record("refine", prompt)


def fixtures() -> list[dict[str, Any]]:
    standard = "اعلم أنّ الوجود أظهر الأشياء تصوّراً وأخفاها كنهاً وحقيقةً."
    doctrinal = "هذا فصل في التوحيد والصفات وبيان معنى الإيمان والقدر."
    long_text = ("قال المصنف إن العلم طريق إلى معرفة الحق والعمل به. " * 15).strip()
    return [
        {
            "name": "short_standard",
            "seg": {"kind": "body", "ar": standard},
            "local_confidence": 0.89,
            "why": "short, non-doctrinal segment starts in the bulk tier",
        },
        {
            "name": "doctrinal",
            "seg": {"kind": "body", "ar": doctrinal},
            "local_confidence": 0.89,
            "why": "Arabic doctrinal marker routes directly to frontier",
        },
        {
            "name": "long_segment",
            "seg": {"kind": "body", "ar": long_text},
            "local_confidence": 0.89,
            "why": "source exceeds the 600-character frontier threshold",
        },
        {
            "name": "low_model_confidence_theoretical",
            "seg": {"kind": "body", "ar": standard},
            "local_confidence": 0.60,
            "why": "probe forces confidence below 0.8, causing bulk then frontier",
        },
        {
            "name": "tm_exact",
            "seg": {"kind": "body", "ar": standard},
            "local_confidence": 0.89,
            "tm_exact": True,
            "why": "approved exact Arabic match bypasses every model",
        },
        {
            "name": "sacred_canonical_hit",
            "seg": {"kind": "sacred", "ar": "إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ"},
            "local_confidence": 0.89,
            "why": "seeded canonical match bypasses every model",
        },
        {
            "name": "sacred_canonical_miss",
            "seg": {"kind": "sacred", "ar": "نص مقدس غير موجود في المخزن"},
            "local_confidence": 0.89,
            "why": "missing canonical entry is held for human review without MT",
        },
    ]


def representative_context(seg: dict[str, Any], *, exact_tm: bool = False) -> dict[str, Any]:
    glossary = [
        {"term_ar": "الوجود", "term_en": "existence"},
        {"term_ar": "التوحيد", "term_en": "the oneness of God"},
        {"term_ar": "الصفات", "term_en": "the divine attributes"},
        {"term_ar": "العلم", "term_en": "knowledge"},
        {"term_ar": "المعرفة", "term_en": "gnosis"},
        {"term_ar": "الحقيقة", "term_en": "reality"},
        {"term_ar": "النفس", "term_en": "the soul"},
        {"term_ar": "العقل", "term_en": "the intellect"},
        {"term_ar": "الحكمة", "term_en": "wisdom"},
        {"term_ar": "الفقه", "term_en": "jurisprudence"},
        {"term_ar": "الأصول", "term_en": "legal theory"},
        {"term_ar": "الرواية", "term_en": "narration"},
    ]
    context: dict[str, Any] = {
        "glossary": glossary,
        "style_rules": [
            "Use precise scholarly English.",
            "Preserve paragraph and footnote structure.",
            "Do not simplify technical claims.",
        ],
        "instructions": "Prefer clear academic prose while preserving technical distinctions.",
    }
    if exact_tm:
        context["tm_matches"] = [
            {"ar": seg["ar"], "en_approved": "Approved prior translation.", "score": 1.0}
        ]
    return context


def run_translation_scenarios(models: dict[str, str]) -> tuple[list[CallRecord], list[dict]]:
    ledger: list[CallRecord] = []
    outcomes: list[dict] = []
    router = Router()
    for fixture in fixtures():
        seg = fixture["seg"]
        decision = router.initial_tier(seg)
        local = ProbeTranslator(
            model=models["bulk"], tier="bulk", scenario=fixture["name"],
            reason=decision.reason, ledger=ledger,
            confidence=fixture["local_confidence"],
            output="A faithful scholarly English translation of the source passage.",
        )
        frontier_reason = decision.reason
        if decision.tier == "local":
            frontier_reason = "bulk result below confidence threshold or blank; escalate to frontier"
        cloud = ProbeTranslator(
            model=models["frontier"], tier="frontier", scenario=fixture["name"],
            reason=frontier_reason, ledger=ledger, confidence=0.92,
            output="A carefully refined scholarly English translation of the source passage.",
        )
        pipe = Pipeline(local=local, cloud=cloud, canonical_db=MockCanonicalDB(), router=router)
        before = len(ledger)
        result = pipe.translate_segment(
            seg, representative_context(seg, exact_tm=bool(fixture.get("tm_exact")))
        )
        calls = ledger[before:]
        outcomes.append(
            {
                "scenario": fixture["name"],
                "initial_tier": decision.tier,
                "route_reason": fixture["why"],
                "final_engine": result.get("engine"),
                "model_calls": len(calls),
                "models_called": dict(Counter(r.model for r in calls)),
                "estimated_prompt_tokens": sum(r.estimated_prompt_tokens for r in calls),
                "estimated_completion_tokens": sum(r.estimated_completion_tokens for r in calls),
                "estimated_cost_usd": round(
                    sum(r.estimated_cost_usd or 0 for r in calls), 8
                ),
            }
        )
    return ledger, outcomes


def add_non_translation_records(ledger: list[CallRecord], models: dict[str, str]) -> None:
    # OCR images have provider-specific token accounting. Only the exact text
    # prompt can be estimated offline; the image component is explicitly unknown.
    ocr_pt = estimate_tokens(_OCR_PROMPT)
    ledger.append(
        CallRecord(
            scenario="one_page_ocr",
            stage="ocr",
            operation="transcribe_page_image",
            model=models["ocr"],
            tier="vision",
            reason="one vision request is made for every rendered PDF page",
            source="pipeline/ocr/engines.py",
            prompt_chars=len(_OCR_PROMPT),
            estimated_prompt_tokens=ocr_pt,
            completion_chars=0,
            estimated_completion_tokens=0,
            estimated_cost_usd=None,
            notes="Image input and Arabic transcription output are unknown offline; provider usage is required.",
        )
    )

    # Chat baseline uses the real static knowledge/tool schemas. This models a
    # one-call answer. Tool follow-up calls resend this prefix and conversation.
    from server.app.chat import APP_KNOWLEDGE, TOOLS

    chat_payload = APP_KNOWLEDGE + json.dumps(TOOLS, ensure_ascii=False) + "User: How is my book doing?"
    chat_pt = estimate_tokens(chat_payload)
    chat_reply = "Your book is processing and its current progress is shown in the Library."
    chat_ct = estimate_tokens(chat_reply)
    ledger.append(
        CallRecord(
            scenario="one_chat_answer",
            stage="chat",
            operation="assistant_or_tool_decision",
            model=models["chat"],
            tier="assistant",
            reason="every creator chat turn calls the configured assistant model; tool loops can repeat it up to five times",
            source="server/app/chat.py",
            prompt_chars=len(chat_payload),
            estimated_prompt_tokens=chat_pt,
            completion_chars=len(chat_reply),
            estimated_completion_tokens=chat_ct,
            estimated_cost_usd=estimated_cost(models["chat"], chat_pt, chat_ct),
            notes="One-call baseline. Each tool round resends system knowledge, tool schemas, and accumulated conversation.",
        )
    )


def aggregate(ledger: list[CallRecord]) -> dict[str, Any]:
    by_model: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"calls": 0, "estimated_prompt_tokens": 0,
                 "estimated_completion_tokens": 0, "estimated_cost_usd": 0.0,
                 "stages": set()}
    )
    by_stage: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"calls": 0, "estimated_prompt_tokens": 0,
                 "estimated_completion_tokens": 0, "estimated_cost_usd": 0.0,
                 "models": set()}
    )
    for r in ledger:
        m = by_model[r.model]
        m["calls"] += 1
        m["estimated_prompt_tokens"] += r.estimated_prompt_tokens
        m["estimated_completion_tokens"] += r.estimated_completion_tokens
        m["estimated_cost_usd"] += r.estimated_cost_usd or 0
        m["stages"].add(r.stage)
        s = by_stage[r.stage]
        s["calls"] += 1
        s["estimated_prompt_tokens"] += r.estimated_prompt_tokens
        s["estimated_completion_tokens"] += r.estimated_completion_tokens
        s["estimated_cost_usd"] += r.estimated_cost_usd or 0
        s["models"].add(r.model)
    for groups, set_key in ((by_model, "stages"), (by_stage, "models")):
        for value in groups.values():
            value[set_key] = sorted(value[set_key])
            value["estimated_cost_usd"] = round(value["estimated_cost_usd"], 8)
    return {"by_model": dict(by_model), "by_stage": dict(by_stage)}


def model_inventory(models: dict[str, str]) -> list[dict[str, Any]]:
    return [
        {
            "runtime": "deployed web pipeline",
            "stage": "OCR",
            "model": models["ocr"],
            "where": "pipeline/ocr/engines.py:196",
            "when": "once per rendered page when OpenRouter OCR is selected/auto-detected",
            "why": "vision transcription of Arabic page images",
            "accounting": "successful response recorded by model/stage in memory; persisted only as aggregate ingest",
        },
        {
            "runtime": "deployed web pipeline",
            "stage": "bulk translation",
            "model": models["bulk"],
            "where": "pipeline/translate/factory.py:45; pipeline/translate/core.py:162",
            "when": "short non-doctrinal, non-sacred, non-TM segments; draft and refine",
            "why": "default inexpensive translation tier",
            "accounting": "per-call model known in memory; DB segment stores only openrouter-cloud and ledger aggregates ingest",
        },
        {
            "runtime": "deployed web pipeline",
            "stage": "frontier translation",
            "model": models["frontier"],
            "where": "pipeline/translate/factory.py:45; pipeline/translate/router.py:62",
            "when": "doctrinal, >600-char, low-OCR-confidence, blank bulk, or bulk confidence <0.8; draft and refine",
            "why": "higher-quality handling of risky passages",
            "accounting": "per-call model known in memory; reason and pass are not persisted",
        },
        {
            "runtime": "deployed web pipeline",
            "stage": "assistant chat",
            "model": models["chat"],
            "where": "server/app/chat.py:24",
            "when": "every creator chat request, repeated for each tool loop up to five calls",
            "why": "answer app questions and choose safe database tools",
            "accounting": "whole chat turn persisted as one aggregate row without model/tool-turn detail",
        },
        {
            "runtime": "deployed web pipeline",
            "stage": "QA and embeddings",
            "model": "offline deterministic mocks",
            "where": "pipeline/qa/scoring.py:55; server/app/embedder.py:79",
            "when": "every translated segment / translation-memory insert",
            "why": "placeholder scoring and deterministic vectors",
            "accounting": "zero provider tokens; despite names, no live back-translator, embedder, sampler, or LLM judge is wired",
        },
        {
            "runtime": "manual legacy script only",
            "stage": "lecture translation",
            "model": "qwen2.5:3b via local Ollama",
            "where": "books/lecture_pipeline.py:46",
            "when": "only when that standalone script is manually run",
            "why": "legacy local lecture translation",
            "accounting": "not part of web ingest and not metered",
        },
        {
            "runtime": "unreachable stubs",
            "stage": "QARI/direct Gemini OCR and direct-provider translators",
            "model": "configuration dependent",
            "where": "pipeline/ocr/engines.py; pipeline/translate/adapters.py",
            "when": "not used by the current OpenRouter web configuration",
            "why": "adapter seams for future/local/provider-direct operation",
            "accounting": "not applicable unless explicitly configured",
        },
    ]


def recommendations(ledger: list[CallRecord], outcomes: list[dict]) -> list[dict[str, Any]]:
    translation = [r for r in ledger if r.stage == "translation"]
    refine = [r for r in translation if r.operation == "refine"]
    draft = [r for r in translation if r.operation == "draft"]
    glossary_all = representative_context(fixtures()[0]["seg"])["glossary"]
    relevant = [g for g in glossary_all if g["term_ar"] in fixtures()[0]["seg"]["ar"]]
    return [
        {
            "priority": 1,
            "finding": "Refine is unconditional for every model-translated segment.",
            "evidence": f"Offline scenarios produced {len(refine)} refine calls and {len(draft)} draft calls; refine prompts include the entire draft prompt again.",
            "optimization": "A/B single-pass bulk translation; retain refine only for frontier/risk/QA failures.",
            "estimated_effect": f"Removes about {sum(r.estimated_prompt_tokens for r in refine)} estimated prompt tokens and {len(refine)} calls in this fixture suite.",
            "quality_gate": "Paid blinded comparison on representative pages is required before changing behavior.",
        },
        {
            "priority": 2,
            "finding": "All glossary terms are injected into every segment and duplicated in refine.",
            "evidence": f"The representative prompt includes {len(glossary_all)} terms although only {len(relevant)} appears in the short source.",
            "optimization": "Filter glossary to source-matching terms plus a very small global must-include set.",
            "estimated_effect": "Savings grow linearly with termbase size and are doubled by current refinement.",
            "quality_gate": "Unit-test Arabic normalization and multi-word matching; no paid call needed.",
        },
        {
            "priority": 3,
            "finding": "OCR confidence now reaches routing, but translation confidence is still hard-coded.",
            "evidence": "Low-confidence OCR is routed directly to frontier; OpenRouter translation adapters still return fixed 0.86/0.89 values.",
            "optimization": "Keep the OCR safeguard and later replace adapter constants with calibrated QA signals.",
            "estimated_effect": "Targets frontier spend at visibly uncertain source text without reducing translation quality.",
            "quality_gate": "Build a labeled OCR/translation error set and calibrate thresholds.",
        },
        {
            "priority": 4,
            "finding": "Frontier Gemini Pro costs roughly 4x Flash at current list rates.",
            "evidence": "$1.25/$10 versus $0.30/$2.50 per million input/output tokens.",
            "optimization": "Keep Pro only where a blinded Arabic quality test proves material improvement; test Flash on long segments and Pro only on doctrinal/canonical misses.",
            "estimated_effect": "Each moved frontier token costs about one quarter as much on Flash at list price.",
            "quality_gate": "Human review by an Arabic/Islamic-text expert is mandatory.",
        },
        {
            "priority": 5,
            "finding": "Chat resends a large static knowledge block and all tool schemas on every tool round.",
            "evidence": "The chat loop allows five calls and accumulates the conversation while repeating the same system/tools prefix.",
            "optimization": "Test Flash-Lite for chat and cap/compact history; preserve Flash fallback for tool failures.",
            "estimated_effect": "Flash-Lite list rates are 67% lower for input and 84% lower for output than Flash, before quality/tool-reliability effects.",
            "quality_gate": "Replay tool-choice and authorization test cases before switching.",
        },
        {
            "priority": 6,
            "finding": "The production database cannot answer which model/pass/reason spent each token.",
            "evidence": "usage_ledger persists only stage=ingest/chat totals; segment.engine is the shared label openrouter-cloud.",
            "optimization": "Add a per-call audit table/JSON event with model, operation, route reason, page/segment, provider tokens, cost, latency, and retry count.",
            "estimated_effect": "Observability improvement; no direct token saving, but enables evidence-based routing.",
            "quality_gate": "Schema migration and privacy review before any production deployment.",
        },
    ]


def prompt_optimization_benchmarks(models: dict[str, str]) -> list[dict[str, Any]]:
    """Controlled prompt/cost comparisons with no model inference."""

    fixture = fixtures()[0]
    seg = fixture["seg"]
    full_context = representative_context(seg)
    relevant_context = dict(full_context)
    relevant_context["glossary"] = [
        item for item in full_context["glossary"] if item["term_ar"] in seg["ar"]
    ]
    # Exercise a realistic future scaling failure: the current loader gives the
    # prompt builder every term, so an established 100-term termbase is repeated
    # in both draft and refine even if only one term is relevant.
    large_context = dict(full_context)
    large_context["glossary"] = list(full_context["glossary"]) + [
        {"term_ar": f"مصطلح{i}", "term_en": f"technical term {i}"}
        for i in range(13, 101)
    ]
    builder = PromptBuilder()
    draft = "A faithful scholarly English translation of the source passage."

    def tokens(context: dict[str, Any], *, refine: bool) -> tuple[int, int]:
        first = builder.build(seg, context).render()
        prompts = estimate_tokens(first)
        completions = estimate_tokens(draft)
        if refine:
            second = builder.build_refine(seg, context, draft).render()
            prompts += estimate_tokens(second)
            completions += estimate_tokens(draft)
        return prompts, completions

    current_pt, current_ct = tokens(full_context, refine=True)
    configurations = [
        ("current: 12-term glossary + draft/refine", full_context, True),
        ("filter glossary + draft/refine", relevant_context, True),
        ("12-term glossary + draft only", full_context, False),
        ("filter glossary + draft only", relevant_context, False),
        ("future 100-term glossary + draft/refine", large_context, True),
    ]
    rows = []
    for name, context, refine in configurations:
        pt, ct = tokens(context, refine=refine)
        rows.append({
            "configuration": name,
            "glossary_terms_sent": len(context["glossary"]),
            "model_calls": 2 if refine else 1,
            "estimated_prompt_tokens": pt,
            "estimated_completion_tokens": ct,
            "estimated_cost_usd": estimated_cost(models["bulk"], pt, ct),
            "prompt_token_change_vs_current_pct": round((pt / current_pt - 1) * 100, 1),
        })

    chat_prompt = _chat_prompt_for_benchmark()  # stable system + tool schema fixture
    chat_pt = estimate_tokens(chat_prompt)
    chat_ct = 25
    rows.extend([
        {
            "configuration": "chat one call on current Flash",
            "glossary_terms_sent": None,
            "model_calls": 1,
            "estimated_prompt_tokens": chat_pt,
            "estimated_completion_tokens": chat_ct,
            "estimated_cost_usd": estimated_cost(models["chat"], chat_pt, chat_ct),
            "prompt_token_change_vs_current_pct": None,
        },
        {
            "configuration": "chat one call on Flash-Lite (same tokens)",
            "glossary_terms_sent": None,
            "model_calls": 1,
            "estimated_prompt_tokens": chat_pt,
            "estimated_completion_tokens": chat_ct,
            "estimated_cost_usd": estimated_cost("google/gemini-2.5-flash-lite", chat_pt, chat_ct),
            "prompt_token_change_vs_current_pct": None,
        },
    ])
    return rows


def _chat_prompt_for_benchmark() -> str:
    """Return the exact static chat prefix without making a chat request."""

    from server.app.chat import APP_KNOWLEDGE, TOOLS

    return APP_KNOWLEDGE + json.dumps(TOOLS, ensure_ascii=False) + "User: How is my book doing?"


def markdown_report(data: dict[str, Any]) -> str:
    models = data["configured_models"]
    lines = [
        "# Haydari LLM usage and token audit",
        "",
        f"Generated {data['generated_on']} by an offline harness. No API calls, database writes, deployments, or paid model calls were made.",
        "",
        "## Current local model selectors",
        "",
        "| Role | Model |",
        "|---|---|",
        f"| OCR | `{models['ocr']}` |",
        f"| Bulk translation | `{models['bulk']}` |",
        f"| Frontier translation | `{models['frontier']}` |",
        f"| Assistant chat | `{models['chat']}` |",
        "",
        "## Exact usage inventory",
        "",
        "| Runtime | Stage | Model | When and why | Current accounting |",
        "|---|---|---|---|---|",
    ]
    for item in data["inventory"]:
        lines.append(
            f"| {item['runtime']} | {item['stage']} | `{item['model']}` | "
            f"{item['when']}; {item['why']} | {item['accounting']} |"
        )
    lines.extend([
        "",
        "## Offline routing benchmark",
        "",
        "The harness executes the real router and prompt builder with recording adapters. Prompt character counts and call counts are exact for these fixtures; tokens and cost are estimates.",
        "",
        "| Scenario | Initial route | Calls | Models | Est. input | Est. output | Est. cost | Why |",
        "|---|---:|---:|---|---:|---:|---:|---|",
    ])
    for row in data["scenario_outcomes"]:
        models_called = ", ".join(f"{m} ×{n}" for m, n in row["models_called"].items()) or "none"
        lines.append(
            f"| {row['scenario']} | {row['initial_tier']} | {row['model_calls']} | "
            f"{models_called} | {row['estimated_prompt_tokens']} | "
            f"{row['estimated_completion_tokens']} | ${row['estimated_cost_usd']:.6f} | "
            f"{row['route_reason']} |"
        )
    lines.extend([
        "",
        "## Controlled token-optimization comparisons",
        "",
        "All translation rows use the same short Arabic segment and exact production prompt builder. No model was called.",
        "",
        "| Configuration | Terms sent | Calls | Est. input | Est. output | Est. list cost | Input change vs current |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ])
    for row in data["optimization_benchmarks"]:
        terms = "—" if row["glossary_terms_sent"] is None else str(row["glossary_terms_sent"])
        change = "—" if row["prompt_token_change_vs_current_pct"] is None else f"{row['prompt_token_change_vs_current_pct']:+.1f}%"
        cost = "unknown" if row["estimated_cost_usd"] is None else f"${row['estimated_cost_usd']:.6f}"
        lines.append(
            f"| {row['configuration']} | {terms} | {row['model_calls']} | "
            f"{row['estimated_prompt_tokens']} | {row['estimated_completion_tokens']} | "
            f"{cost} | {change} |"
        )
    lines.extend([
        "",
        "## Highest-value optimizations",
        "",
    ])
    for rec in data["recommendations"]:
        lines.extend([
            f"### {rec['priority']}. {rec['finding']}",
            "",
            f"Evidence: {rec['evidence']}",
            "",
            f"Change to test: {rec['optimization']}",
            "",
            f"Expected effect: {rec['estimated_effect']}",
            "",
            f"Required gate: {rec['quality_gate']}",
            "",
        ])
    lines.extend([
        "## Important interpretation limits",
        "",
        "- This is a routing and token-overhead benchmark, not a translation-quality benchmark.",
        "- Token estimates use `ceil(Unicode characters / 3)`. Only provider-returned usage is exact.",
        "- OCR image token cost cannot be estimated reliably without an actual provider response.",
        "- Retries that time out after the provider processed a request may be billed but are not currently recorded unless a response returns.",
        "- The low-confidence scenario is theoretical: current OpenRouter adapters assign fixed confidence values rather than measuring output confidence.",
        "",
        "## Price references",
        "",
    ])
    for model, url in PRICE_SOURCES.items():
        price = MODEL_PRICES[model]
        lines.append(f"- [{model}]({url}): ${price[0]:g}/M input, ${price[1]:g}/M output (checked 2026-07-30).")
    lines.extend([
        "",
        "## Reproduce",
        "",
        "```bash",
        "python -m benchmarks.llm_usage_audit",
        "```",
        "",
        "See `model_calls.json` for every individual offline call, including operation and route reason.",
        "",
    ])
    return "\n".join(lines)


def run(output_dir: Path) -> dict[str, Any]:
    models = read_model_config()
    ledger, outcomes = run_translation_scenarios(models)
    add_non_translation_records(ledger, models)
    data: dict[str, Any] = {
        "generated_on": date.today().isoformat(),
        "mode": "offline-no-network",
        "token_estimator": "ceil(unicode_characters / 3)",
        "configured_models": models,
        "inventory": model_inventory(models),
        "scenario_outcomes": outcomes,
        "optimization_benchmarks": prompt_optimization_benchmarks(models),
        "aggregate": aggregate(ledger),
        "recommendations": recommendations(ledger, outcomes),
        "calls": [asdict(r) for r in ledger],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "model_calls.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (output_dir / "LLM_USAGE_AUDIT.md").write_text(markdown_report(data), encoding="utf-8")
    return data


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    args = parser.parse_args(argv)
    data = run(args.output_dir)
    translation_calls = sum(1 for r in data["calls"] if r["stage"] == "translation")
    print(f"Wrote {args.output_dir / 'LLM_USAGE_AUDIT.md'}")
    print(f"Wrote {args.output_dir / 'model_calls.json'}")
    print(f"Recorded {translation_calls} offline translation calls; network calls: 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
