"""A/B *any* OpenRouter models on a real Arabic segment — side by side + cost.

One OpenRouter key → compare Western and Chinese frontier models on the exact
same Arabic, so the winner is decided on YOUR text, not a generic benchmark.

    # compare the default shortlist on the built-in sample
    python -m pipeline.translate.ab_compare

    # your own Arabic + your own model shortlist
    python -m pipeline.translate.ab_compare --file page.txt \
        --models google/gemini-2.5-flash qwen/qwen3-235b-a22b \
                 google/gemini-3-pro anthropic/claude-opus-4.8 moonshotai/kimi-k2.5

Each model runs the full pipeline path (draft → refine → glossary enforce), so
what you see is what production produces. A model id OpenRouter doesn't have just
errors for that row and the rest continue — check https://openrouter.ai/models
for exact current ids. Needs OPENROUTER_API_KEY (https://openrouter.ai/keys).
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

from .adapters import OpenRouterTranslator
from .core import Pipeline
from .interfaces import NotConfiguredError
from .prompt import PromptBuilder


def _load_env_file() -> None:
    """Load keys from ``server/.env`` (repo-relative) if not already in the env.

    So the harness picks up the OpenRouter key you pasted into server/.env with
    no extra `export`. An already-set env var wins.
    """
    env_file = Path(__file__).resolve().parents[2] / "server" / ".env"
    if not env_file.exists():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value

# A diverse default shortlist: value + frontier, Western + Chinese. Edit freely;
# ids that OpenRouter doesn't recognise simply error for that row.
DEFAULT_MODELS = [
    "google/gemini-2.5-flash",       # value pick (Western)
    "qwen/qwen3-235b-a22b",          # top open model for Arabic (HELM), Chinese
    "google/gemini-3-pro",           # frontier (Western)
    "anthropic/claude-opus-4.8",     # frontier (Western)
    "moonshotai/kimi-k2.5",          # frontier (Chinese)
]

# Rough $/1M (input, output) for a per-segment estimate, keyed by id substring.
# Approximate list prices — confirm on OpenRouter. Unknown ids show tokens only.
PRICE_HINTS = {
    "gemini-2.5-flash": (0.15, 1.25),
    "gemini-2.5-pro": (1.25, 10.0),
    "gemini-3": (2.0, 12.0),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-5": (1.25, 10.0),
    "claude-sonnet": (3.0, 15.0),
    "claude-opus": (5.0, 25.0),
    "qwen3-235b": (0.20, 0.60),
    "qwen3-max": (1.25, 3.75),
    "deepseek": (0.14, 0.28),
    "kimi-k2": (0.60, 3.41),
    "minimax": (0.30, 1.20),
}

SAMPLE_AR = "اعلم أنّ الوجود أظهر الأشياء تصوّراً وأخفاها كنهاً وحقيقةً."


def _est_tokens(text: str, *, arabic: bool = False) -> int:
    return max(1, len(text) // (3 if arabic else 4))


def _price_for(model_id: str):
    for frag, price in PRICE_HINTS.items():
        if frag in model_id:
            return price
    return None


def _run_model(model_id: str, seg: dict, context: dict) -> None:
    print("\n" + "=" * 74)
    print(model_id)
    print("-" * 74)
    engine = OpenRouterTranslator(model=model_id)
    forced = dict(seg, doctrinal=True)  # force the cloud tier so this model runs
    pipe = Pipeline(cloud=engine)
    try:
        t0 = time.monotonic()
        out = pipe.translate_segment(forced, context)
        dt = time.monotonic() - t0
    except NotConfiguredError as e:
        print(f"⚠  {e}")
        return
    except Exception as e:  # noqa: BLE001 — a bad model id / API error shouldn't stop the sweep
        print(f"✗  error: {e}")
        return

    en = out.get("en", "")
    print(en or "(empty)")
    prompt = PromptBuilder().build(seg, context)
    in_tok = (_est_tokens(prompt.system) + _est_tokens(prompt.user, arabic=True)) * 2
    out_tok = _est_tokens(en) * 2
    price = _price_for(model_id)
    print("-" * 74)
    line = f"confidence={out.get('confidence'):.2f}  {dt*1000:.0f} ms  ~{in_tok} in + {out_tok} out tok"
    if price:
        seg_cost = in_tok / 1e6 * price[0] + out_tok / 1e6 * price[1]
        line += f"  ~${seg_cost:.5f}/seg  ~${seg_cost*3000:,.2f}/1000 pages (list price)"
    print(line)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="A/B any OpenRouter models on one Arabic segment.")
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--ar", help="Arabic text to translate")
    src.add_argument("--file", help="path to a UTF-8 file of Arabic text")
    ap.add_argument("--models", nargs="+", default=DEFAULT_MODELS,
                    help="OpenRouter model ids to compare")
    ap.add_argument("--kind", default="body", choices=["body", "footnote"])
    args = ap.parse_args(argv)

    _load_env_file()  # pick up OPENROUTER_API_KEY from server/.env

    if args.file:
        with open(args.file, encoding="utf-8") as fh:
            ar = fh.read().strip()
    else:
        ar = args.ar or SAMPLE_AR

    seg = {"kind": args.kind, "ar": ar}
    context = {
        "glossary": [{"term_ar": "الوجود", "term_en": "existence"}],
        "style_rules": ["Prefer precise, scholarly English over paraphrase."],
    }

    print("SOURCE (Arabic):")
    print(ar)
    for model_id in args.models:
        _run_model(model_id, seg, context)
    print()
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
