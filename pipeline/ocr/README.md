# Haydari OCR pipeline (`pipeline/ocr`)

VLM/OCR → layout & footnote structuring → reading-ordered **Markdown** with
indexed `[[FN-n]]` anchors + typed **segments** (`body` / `footnote` / `sacred`).

This is the OCR stage of the platform described in `ARCHITECTURE.md`. It runs
**fully offline** through a deterministic mock engine; real engines swap in via
environment variables when available.

## Contract

```python
from pipeline.ocr import process_page

process_page(image_path) -> {
    "markdown": str,                       # reading-ordered, RTL-safe, [[FN-n]] anchors
    "segments": [ {order, kind, ar, anchor, confidence} ],
    "confidence": float,                   # page-level, for the router
    "engine": str,
    "anchor_mismatch": None | {            # None when anchors are consistent
        "body_orphans": [...],             # body [[FN-n]] with no footnote
        "footnote_orphans": [...],         # footnotes with no body reference
        "duplicate_footnotes": [...],      # same anchor on 2+ footnotes
        "body_refs": [...], "footnote_anchors": [...], "ok": False,
    },
}
```

All emitted anchors are **ASCII** `[[FN-n]]` even when the source used
Arabic-Indic digits (`(٣)` or a pre-formed `[[FN-٣]]`), so body numbering lines
up with footnote numbering and matches downstream QA's `[[FN-n]]` pattern.
After classification the body `[[FN-n]]` references are cross-checked against
the footnote-segment anchors; any mismatch/orphan/duplicate is surfaced in
`anchor_mismatch` (non-fatal) so QA / human review catches silent off-by-one
numbering. `check_anchors(segments)` is exposed for direct use.

- `kind ∈ {body, footnote, sacred}`.
- Footnote **references** in body text are the indexed, positionally-verifiable
  marker `[[FN-n]]` — never a bare glyph. The matching footnote **segment**
  carries `anchor = "FN-n"` with the same `n`.
- `confidence` (page and per-segment) lets the translation router escalate
  low-confidence pages from the local engine to a cloud one.

There is also `process_pdf(pdf_path)` which renders each page with Poppler
`pdftoppm` and calls `process_page` per page (adds `page_no`, `image_path`).

## How it works

| Module | Responsibility |
|---|---|
| `engines.py` | `OcrEngine` interface + `MockOcrEngine`, `QariOcrEngine` (stub), `GeminiOcrEngine` (stub), `select_engine()`. Engines do **raw** recognition only: text blocks + region hint + confidence. |
| `classifier.py` | Pure structure step: split body/footnote at the divider, rewrite `(١)`/`[3]` → `[[FN-n]]`, match footnotes to `anchor="FN-n"`, flag Qurʾan/Hadith with transparent heuristics. |
| `emitter.py` | Reading-ordered Markdown; sacred lines as block quotes; footnote lines prefixed with their `[[FN-n]]` anchor; RTL text left byte-for-byte intact (with an optional U+200F prefix). |
| `render.py` | `render_pdf()` — Poppler `pdftoppm` wrapper. |
| `pipeline.py` | `process_page`, `process_pdf`. |
| `fixtures/mock_page.json` | Fabricated Arabic page (8 segments: 4 body, 2 sacred incl. Qurʾan 57:3, 2 footnotes) mirroring the review-workbench mockup. |

### Engine selection

`select_engine()` reads `$HAYDARI_OCR_ENGINE` (`mock` | `qari` | `gemini`).
With nothing set it auto-detects a configured local engine, else falls back to
the **mock** so the platform always runs offline.

- **QARI-OCR** (production default, local): set `$QARI_MODEL_PATH`. Inference is
  a clearly-marked stub — it raises a "not configured" `OcrError` until wired up.
- **Gemini** (cloud escalation of hard pages): set `$GEMINI_API_KEY`
  (+ optional `$GEMINI_OCR_MODEL`). Also a marked stub.

Real adapters parse their Markdown output into blocks with
`engines.blocks_from_markdown()`, so the classifier/emitter stay unchanged.

## Sacred-text flagging

A transparent, testable heuristic (`classifier.detect_sacred`) marks a block
`sacred` when it has Qurʾan cues (`﴿ ﴾`, `قال الله تعالى`, a sura citation
`[الحديد: ٣]`), a strong Hadith attribution (`قال النبي`, `صلى الله عليه وسلم`,
…), or matches a tiny canonical verse index (diacritic-insensitive). It is
deliberately conservative so meta-discussion like *أهل الحديث* is **not**
flagged. In production this is replaced by embedding similarity against the
trusted Qurʾan/Hadith DB (RESEARCH.md), which then does *detect-and-replace* in
the translate stage.

## Install & run (offline)

```bash
python3 -m venv .venv && .venv/bin/pip install -r pipeline/ocr/requirements.txt
.venv/bin/python -m pytest pipeline/ocr/tests -q      # 20 tests, all offline
```

The core pipeline + mock need only the standard library; `pytest` is the sole
pip dependency. `pdftoppm` (Poppler) is a system dependency, already installed
on the target Mac, needed only for `process_pdf`.

Quick demo:

```python
from pipeline.ocr import process_page
page = process_page("any.png")   # mock; pixels ignored
print(page["markdown"])
```

## Tests (what they prove)

- `[[FN-n]]` anchors are emitted in body text and **matched** to footnote
  segments carrying `anchor="FN-n"` (set equality body refs ↔ footnote anchors).
- Sacred lines (Qurʾan 57:3, a Hadith) are flagged `kind=="sacred"`; plain body
  is not.
- Body/footnote split works on the fixture (divider separates the regions).
- Confidence is present and deterministic; engine stubs raise a clear
  "not configured" error; default engine is the mock.
