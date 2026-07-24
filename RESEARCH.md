# Research — Improving & Automating the Haydari Translation Pipeline

**Scope:** best/latest (2025–2026) tools, open-source projects, models, and methods to make the
Arabic→English Islamic-text pipeline more accurate, more automated, and more faithful on
footnotes/layout — running **hybrid** (prefer local/open-source on a single Apple-Silicon Mac,
use paid cloud APIs where they clearly win).

## How to read this (provenance & confidence)

This report was assembled from a multi-agent web-research run (fan-out search → source fetch →
claim extraction → adversarial verification), stopped early to save cost, then **extended with a
second round of direct verification** (searches + primary-source fetches) done in-session. So:

- ✅ **Verified** = cross-checked against a primary source. Now covers: **KITAB-Bench OCR numbers**,
  **QARI-OCR** facts, the **aiXplain translation table** (fetched and read directly from the PDF),
  **Baseer** (arXiv abstract + Misraj blog), and **Docling's RTL failures** (its own GitHub issues).
- ⚠️ **Extracted, not re-verified** = from a named source with a supporting quote, but no independent
  re-check yet (e.g. Doha-Dictionary RAG uplift, Gemini OCR $/page, IslamicMMLU, MLX-vs-Ollama numbers).
  Strong leads — confirm exact figures before betting on them.
- Some sources are **blogs** (marked); some cite 2026 model versions (Gemini 3, GPT-5, Claude Opus 4.5,
  Qwen3.x, Ollama 0.19) — plausible for the date but treat version-specific numbers as "per source."
- **One correction from round 2:** a web-search *summary* claimed ALLaM-7B/Command-R+ led on translation
  (~26–27). That was a mis-read of the *Summarization* column. The primary PDF confirms the original
  extraction: on **Translation**, GPT-4.1-mini leads and the Arabic-specialized models are the weakest.
  (Lesson: verify against the source table, not a search snippet.)

**Bottom line up front — the single highest-impact change:** replace the Tesseract/Apple-Vision +
OpenCV-divider OCR stage with a **VLM-based OCR that outputs structured Markdown** (Arabic-specialized
**QARI-OCR** locally, **Gemini 2.0 Flash** as cloud fallback). One swap fixes the three most fragile
things at once — Arabic OCR accuracy, RTL reading order, and body/footnote separation.

---

## ⭐ Closest real-world analogue — read this one paper

✅ **"Automated Translation of Islamic Literature Using LLMs: Al-Shamela Library Application"** (Khair &
Sawalha, COLING-Rel 2025 — [pdf](https://aclanthology.org/2025.clrel-1.5.pdf); fetched and read in full).
A deployed system from the *International Computing Institute for Quran and Islamic Sciences* that
translated **250,000+ pages** of Al-Shamela works (Quran, Tafsir, Hadith, Jurisprudence) Arabic→English.
It is essentially a production version of the Haydari pipeline, and its concrete choices are directly usable:

- **OCR = a multimodal LLM.** They OCR image-PDFs with **GPT-4o** (page image → base64 → prompt: "transcribe
  the Arabic, maintain diacritics and Quranic pause marks"), after denoise/sharpen pre-processing. They
  explicitly reject traditional Arabic OCR as high-cost and poor at diacritics — **independent confirmation
  of this report's #1 recommendation.**
- **Translation model = GPT-4o-mini.** After comparing open (Llama-3.2-3B, Qwen-2.5-3B, Silma-9B, Jais-13B,
  Mistral-7B) and proprietary (GPT-4o/-mini, Claude-3.5 Sonnet/Haiku), they picked **gpt-4o-mini** for the
  best cost/speed/quality balance; small open models had "limited translation quality" and sometimes reverted
  to their dominant language (English for Llama-3.2, Chinese for Qwen-2.5). Matches the aiXplain finding.
- **Quran/Hadith = RAG detect-and-replace (do this).** Match each Quran verse / Hadith against a **trusted
  validated database** by embedding cosine similarity, then **replace the OCR'd/translated sacred text with
  the canonical retrieved version**, and **always output both the Arabic source and the English** for such
  passages. This is the single most important religious-accuracy technique and it is used in production.
- **QA = back-translation + embedding similarity (reference-free).** Validate a translation by
  **back-translating English→Arabic with two independent models (OpenAI *and* Anthropic)** and measuring
  cosine similarity between the original and back-translated Arabic embeddings. A far better automated
  adequacy gate than the current footnote-count check — and it needs no human reference.
- **Prompt template (9 points):** proficient Arabic→English; **no transliteration**; use established Islamic
  terminology; stay readable; preserve the truthful sense; **for Quran/Hadith give both Arabic + English**;
  keep page/paragraph/list formatting; bold headings; chapter breaks with page breaks.
- **HITL + storage:** one-page-per-row DB (same shape as Haydari's SQLite); crowd-sourced review where **a
  correction needs ≥2 reviewers**; then lock the output PDF. Outputs to Word/Excel/PDF (+ optional TTS audiobook).

**Also new (workflow never searched this): the source text may already be digitized.**
⚠️ **OpenITI / al-Shamela** ([openiti.org](https://openiti.org/), [KITAB](https://kitab-project.org/)) is an
open corpus of **~4,300+ premodern Islamicate titles / ~1.5B words**, built partly from al-Shamela's 6,111
books. **Before OCR'ing a scan, check whether the book already exists as clean digital Arabic text** in
OpenITI/Shamela — that skips Stages 1–2 entirely for those titles and eliminates OCR error as a source of
sacred-text corruption. It's also a source for terminology lists and RAG grounding.

---

## Stage 1 — Arabic OCR / document AI

**Finding: the current OCR stage is the weakest link, and traditional engines are the wrong tool for Arabic.**

✅ **Verified (KITAB-Bench, ACL 2025, MBZUAI — [github](https://github.com/mbzuai-oryx/KITAB-Bench),
arXiv:2502.14949):** on Arabic OCR, character error rate (CER, lower is better):

| Engine | CER | Notes |
|---|---|---|
| **Gemini-2.0-Flash** (cloud VLM) | **0.13** | best; also cheap (see cost note) |
| GPT-4o (cloud VLM) | 0.31 | |
| Qwen2.5-VL (open VLM) | 0.49 | best open general VLM here, still lagging |
| Tesseract `ara` (current fallback) | **0.54** | weak |
| EasyOCR | 0.58 | weak |
| Surya (open) | **4.95** | *collapses* on Arabic — do not use for Arabic OCR |
| PaddleOCR (legacy) | 0.79 | weak |

Paper's own summary: modern VLMs beat traditional OCR by ~60% average CER. Proprietary VLMs also
dominate table recognition (GPT-4o 85.7%, Gemini 83.0% vs Tesseract 28.2%).

✅ **Verified — QARI-OCR** (arXiv:[2506.02295](https://arxiv.org/abs/2506.02295), models at
[NAMAA-Space on HF](https://huggingface.co/collections/NAMAA-Space)): an **Arabic-specialized**
Qwen2-VL-2B fine-tune, open weights, **open-source SOTA on diacritized Arabic** — WER 0.160, CER 0.061,
BLEU 0.737. Explicitly handles **tashkeel, ligatures, classical letterforms, Hamza orthography, and
low-resolution/poor scans**. Verified detail that matters here: its **synthetic training data was rendered
from modern news *and* classical Islamic texts** across 12 Arabic fonts — i.e. it was built for exactly
this genre. A 2B model runs on Apple Silicon (it's a standard Qwen2-VL, so transformers/MLX-VLM/vLLM all
load it); a **4B v0.4** now exists. Models: [NAMAA-Space/Qari-OCR-0.1-VL-2B-Instruct](https://huggingface.co/NAMAA-Space/Qari-OCR-0.1-VL-2B-Instruct). Against the current stack it's night-and-day (the QARI paper's own table puts
Tesseract at CER 0.911, EasyOCR 0.648 vs QARI 0.059).

⚠️ **Other strong open candidates (extracted, confirm before adopting):**
- ✅ **Baseer** (arXiv:[2509.18174](https://arxiv.org/abs/2509.18174), Misraj AI —
  [blog](https://misraj.ai/en/blogs/baseer-arabic-document-ocr-vlm-misraj)) — Qwen2.5-VL-3B fine-tune that
  converts Arabic docs **directly to Markdown**; **WER 0.25 on the expert-verified Misraj-DocOCR benchmark
  (400 pages), beating GPT-5 (0.86), Gemini-2.5-Pro (0.37), and Azure Document Intelligence (0.44)** —
  verified against the abstract + Misraj blog. The best "OCR→structured-text in one pass" option for Arabic.
  *(Check weight availability/licensing before adopting.)*
- **Nanonets-OCR2-3B** — explicitly lists Arabic support (per HF, Oct 2025).
- **PaddleOCR-VL** (arXiv:[2510.14528](https://arxiv.org/html/2510.14528v1)) — 0.9B doc-parsing VLM,
  compact for RAM-limited use; the legacy PaddleOCR weakness above does **not** apply to this new line.
- **dots.ocr** (~3B) — excellent general doc parser, GGUF builds for MLX/llama.cpp, **but Arabic not
  explicitly listed** — verify on real pages before trusting.

**Cloud cost/latency (⚠️ getomni ocr-leaderboard, Feb 2025):** Gemini 2.0 Flash ≈ **$0.88 / 1,000 pages**
at high accuracy, vs Azure GPT-4o $18.52 and Claude 3.5 Sonnet $19.89. VLM OCR is slower per page
(~10–25 s) than traditional doc-AI (~3–4 s), but at one-book-at-a-time that's irrelevant.
Leaderboard: [getomni-ai/ocr-leaderboard](https://huggingface.co/datasets/getomni-ai/ocr-leaderboard).

**Recommendation:** drop Tesseract/Apple-Vision for Arabic. Default to **QARI-OCR (local, MLX)**; route
low-confidence or badly-degraded pages to **Gemini 2.0 Flash (cloud)**. Prefer a model that emits
**Markdown** so Stage 2 largely disappears (Baseer/Gemini do this natively).

---

## Stage 2 — Layout, footnote separation & RTL reading order

**Finding: the OpenCV horizontal-divider heuristic (fallback 84% cut) is fragile; use model-based layout —
or better, let a VLM emit structure directly.**

⚠️ **Extracted (confirm RTL behavior — several tools have weak/unverified Arabic support):**
- **Docling** (IBM Research, MIT license — [github](https://github.com/docling-project/docling)) — has a
  dedicated **`Footnote` layout class** (among 17 types incl. Page-header/footer, Section-header, Table)
  and emits a **DoclingDocument** JSON with full provenance (page, bbox, element type per chunk) — great in
  principle for body/footnote separation. ✅ **But its Arabic/RTL handling is currently broken**, per its
  *own* open issue tracker: text extracted **reversed at both word and character level**, wrong reading
  order, and jumbled mixed Arabic/English — issues [#1938](https://github.com/docling-project/docling/issues/1938),
  [#2179](https://github.com/docling-project/docling/issues/2179), [#455](https://github.com/DS4SD/docling/issues/455),
  [#253](https://github.com/DS4SD/docling/issues/253), [#3462](https://github.com/docling-project/docling/issues/3462).
  Use Docling's **layout classification** if helpful, but **do not rely on its text output for Arabic** —
  pair it with a real Arabic OCR (QARI/Baseer/Gemini). Newer "heron" layout model (arXiv:2509.11720) improved mAP ~23%.
- **Surya layout** ([github](https://github.com/datalab-to/surya)) — detects a `Footnote` element and
  reading order across 90+ languages. Use its **layout model only** — its OCR collapses on Arabic (above).
  License: code Apache-2.0, **weights are restricted** (free only for research/personal/small orgs).
- **MinerU** (Apache-2.0 — [github](https://github.com/opendatalab/mineru)) — auto-removes
  headers/footers/**footnotes**, outputs reading-ordered Markdown/JSON, runs on Apple-Silicon MPS
  (2–8 GB). Note it *removes* footnotes for coherence — you'd want to capture them, not discard.
- **Marker** ([github](https://github.com/datalab-to/marker)) — PDF→Markdown/JSON, footnote handling,
  built on Surya; optional `--use_llm` (Gemini/Claude/OpenAI) for hard pages. **License GPL-3.0 + paid
  commercial license above $2M** — check if that affects you.
- **pdf-craft** — purpose-built for **scanned books**, auto-filters headers/footers, handles footnotes.
- Comparison writeup (blog, 2026): [Marker vs Docling vs MinerU vs pdf-craft vs PyMuPDF4LLM](https://themenonlab.blog/blog/best-open-source-pdf-to-markdown-tools-2026).

**Recommendation:** prefer **VLM-OCR that outputs Markdown with footnotes** (Baseer/Gemini/QARI-with-prompt)
so you don't maintain a separate splitter. Keep **Docling** or **Surya-layout** as a fallback classifier
for pages where the VLM's structure is unreliable. **Whatever you pick, validate RTL reading order on real
Haydari pages — Arabic support is the weakest-documented dimension across all these tools.**

---

## Stage 3 — Machine translation (Arabic→English, religious/classical)

**Finding #1: Arabic-specialized models do NOT win at translation. Frontier general models do. The best
*open* translator is Qwen3-14B — which runs on a Mac.**

✅ **Verified (aiXplain Arabic LLM Benchmark, May 2025 — [pdf](https://aixplain.com/wp-content/uploads/2025/05/aiXplain-Arabic-Benchmark-Report-May-2025-v2.1.pdf); table read directly from the PDF):**
Translation column (BLEU, higher better): **GPT-4.1 mini 19.99** > **Qwen3-14B 18.38** > GPT-4o-mini 17.53
> GPT-4.1 16.00 > Qwen3-32B 14.40 > **Command R+ 13.73** > Gemma-2-9B / Qwen2.5-32B 11.50 > LFM-40B 10.54
> **ALLaM-13B 10.50 / ALLaM-7B 9.60** > **Fanar C-1 4.74** (worst non-tiny) > Llama-3.2-3B 2.95.
Two hard conclusions: *(a)* **every** model scored under 20 BLEU — MT quality is uniformly modest, so a
review/refine loop matters; *(b)* the **Arabic-specialized** models (ALLaM, Fanar) are among the **worst**
translators, while **Qwen3-14B is the standout open model** — a better local default than the current Aya-8B.

**Finding #2: Arabic pretraining ≠ Islamic knowledge; doctrinal accuracy needs frontier models or RAG.**

⚠️ **Extracted (IslamicMMLU, arXiv 2603.23750; a 10,013-question MSA benchmark over Quran/Hadith/Fiqh):**
frontier models lead on Islamic knowledge (Gemini 3 Flash 93.8%, GPT-5 89.9%; Claude Opus 4.5 strong on
Quran 94.6% / Hadith 90.8% but weaker on **Fiqh 72.7%**), while Arabic-specialized models trail (Jais-2-70B
63.4%, ALLaM-7B 59.5%). Best Arabic-specific was **Fanar-Sadiq 81.6%**. Implication: **Fiqh/jurisprudential
reasoning is a weak spot even for top models** — flag those passages for human review.

**Finding #3: RAG over Quran/hadith is the biggest quality lever — and for sacred text, replace rather than
translate.**

✅ **Confirmed by the Al-Shamela paper (above) + IslamicEval 2025 work:** for Quran/hadith, don't rely on the
model to translate accurately — **detect the quotation, retrieve the canonical verified Arabic + an approved
English rendering from a trusted database, and substitute it.** Related IslamicEval 2025 systems report
~86% F1 identification / ~90% verification for Quran/hadith content
([TCE](https://aclanthology.org/2025.arabicnlp-sharedtasks.71.pdf)).

⚠️ **Extracted, corroborating ("Grounding Arabic LLMs in the Doha Historical Dictionary", arXiv 2603.23972):**
a RAG pipeline lifted Fanar **54%→89%** and ALLaM **57%→86%** answer-correctness on Quran/Hadith lexical
questions (Gemini 88%→96%). Notably **BM25 (sparse) beat dense embedding retrievers** for citation-style
lookups (queries reference exact words present in the text), and a **bge-reranker-v2-m3** cross-encoder
pushed MRR 0.68→0.94. Practical detail: **strip diacritics for retrieval matching, but keep them for
generation** (they disambiguate words with identical consonants).

**Prompt (from the Al-Shamela deployment):** no transliteration; use established Islamic terminology; preserve
the truthful sense; **for Quran/Hadith output both Arabic and English**; keep list/paragraph/heading formatting.

**Techniques worth adopting (⚠️ from pipeline projects, below):**
- **Terminology glossary injection** + auto-extraction (Turjuman, translate-book) for cross-book consistency.
- **Cross-chunk context**: feed short read-only prev/next excerpts so pronouns/entities resolve across chunks.
- **Two-pass self-reflection / critique-refine** raises the local-model quality ceiling (KazKozDev, Turjuman Deep Mode).

**Recommendation (hybrid):** for cost, run a **stronger local model than Aya-8B** — Qwen3-14B or Command-R if
RAM allows (see Stage 5 sizing); for quality-critical or doctrinal passages, route to **cloud Claude/Gemini**.
Add a **glossary + BM25-RAG grounding** for Quran/hadith terminology, and a **second refinement pass**.
Aya Expanse 8B as sole engine is very likely leaving accuracy on the table for religious text.

---

## Stage 4 — Footnote preservation & publishing

**Finding: bare `⚓` glyph + global count is fragile (our own test confirmed it passes on garbage). Use
indexed anchors + a document format with native footnotes.**

⚠️ **Extracted patterns:**
- **Indexed, verifiable markers** instead of a bare glyph: e.g. `[[FN-17]]`, checkable **positionally**, not
  just by count. **Turjuman** ([github](https://github.com/abdallah-ali-abdallah/turjuman-book-translator))
  explicitly identifies and **preserves footnotes/code/URLs** as non-translatable elements during chunking.
- **Manifest integrity check**: **translate-book** ([github](https://github.com/deusyu/translate-book)) uses a
  **SHA-256 manifest enforcing 1:1 source-chunk↔output** — a far better QA than a global marker count.
- **Publishing → use Pandoc/Markdown, not hand-rolled Google Docs API.** Represent the translation as
  **Markdown with `[^n]` footnotes**; **Pandoc** converts to **.docx / PDF with real linked footnotes and an
  auto TOC** trivially. Reference pipelines do exactly this (sweisman/translation-pipeline uses Pandoc→docx;
  translate-book uses Calibre+Pandoc for docx/epub/pdf/HTML-with-floating-TOC).
- If Google Docs output is required, the API pattern is: create a footnote reference, then insert footnote
  text at the index immediately after the reference (blog: [Google Docs API examples](https://www.mikesallese.me/blog/google-docs-api-examples/)).
  This is the missing logic in the current `publish_book_to_google.py` stub.

**Recommendation:** switch the internal representation to **Markdown + `[^n]` footnotes with indexed anchors**,
publish via **Pandoc** (docx/PDF get native footnotes + TOC for free). Keep the Google Docs export as a
secondary target only if the team specifically needs Docs collaboration.

---

## Stage 5 — Orchestration, QA & automation

**Reference pipelines to learn from / adopt (⚠️ extracted):**
- **sweisman/translation-pipeline** ([github](https://github.com/sweisman/translation-pipeline)) — closest
  analogue: orchestrated **Claude** pipeline for classical texts, feeds **scanned page images directly to the
  model (no separate OCR step)**, collates to Markdown/DOCX via **Pandoc**, emits a **discrepancy report**.
  Principle worth stealing: *"reruns must verify, not apply"* — re-runs test hypotheses against the source
  image rather than blindly editing. (~1,500 pages/week on Claude Max; batch 4 pages; 5-min inter-batch delay.)
- **deusyu/translate-book** — manifest integrity, **resumable runs**, up to **8 parallel chunk subagents**,
  pre-built glossary, "scripts do bookkeeping, LLMs do semantic merge."
- **KazKozDev/book-translator** ([github](https://github.com/KazKozDev/book-translator)) — **fully local
  Ollama**, **two-stage draft→refine**, **SQLite** job/chunk store, resumable. Closest to your local-first
  constraint (input is plain text only, though).
- **Turjuman** — LangGraph 7-stage flow (init → terminology unification → chunk → translate → critique →
  refine → assemble); supports OpenAI/Anthropic/**Ollama**/vLLM; recommends Gemini online or Gemma3/Aya/Mistral
  local. (Ingests Markdown/text today, not PDF.)

**Better QA than a marker count:**
- ✅ **Back-translation + embedding cosine similarity (reference-free adequacy — used in the Al-Shamela
  deployment):** back-translate the English→Arabic with **two independent models** and compare embeddings to
  the original Arabic. Cheap, needs no human reference, and catches meaning drift the count check can't.
- ⚠️ Supplement with **chrF / COMET / MetricX** (BLEU is deprecated for this) **+ an MQM-style LLM-as-judge
  rubric** scoring adequacy, fluency, and **footnote placement**. LLM-as-judge (Gemini 2.5 Pro) matched human
  scoring closely (Cohen's κ 0.87) in the Doha study.
- **Footnote QA:** per-chunk **manifest + positional** check (does each `[[FN-n]]` survive and stay attached to
  the right sentence?), not a global count. This directly fixes the design flaw in `KNOWN_ISSUES.md` #5.
- **Human-in-the-loop:** the Al-Shamela project required **≥2 reviewers to accept any correction**, then locked
  the output — a simple, auditable gate worth copying for doctrinal material.

**Running it on one Apple-Silicon Mac (⚠️ blog benchmarks, 2026):**
- **MLX vs Ollama:** for **≤24 GB** unified memory use **Ollama** (llama.cpp Metal); for **≥32 GB** use **MLX**
  (via LM Studio / mlx-lm) — ~15–30% faster, ~10% less memory at the same quant. Ollama 0.19 (Mar 2026) added
  an experimental MLX backend for 32 GB+ Macs. ([willitrunai](https://willitrunai.com/blog/mlx-vs-ollama-apple-silicon-benchmarks))
- **Serving VLM-OCR + translation LLM together** on one box: **Pico AI Server** or **LM Studio** (MLX,
  OpenAI-compatible API) alongside/instead of Ollama.
- **MonkeyOCR-Apple-Silicon** ([HF](https://huggingface.co/Jimmi42/MonkeyOCR-Apple-Silicon)) shows a Qwen2.5-VL
  OCR running ~15–18 s/doc on an M4 Pro via MLX-VLM (~13 GB peak) — proof modern VLM-OCR is feasible locally
  (Arabic support unconfirmed for that specific port).
- An 8–9B 4-bit translation model (~5.5 GB) runs ~22–35 tok/s on a 16 GB M4 — so a bigger/better local
  translator than Aya-8B is within reach on modest hardware.

---

## Stage 6 — Benchmarks, leaderboards & community sources

- **KITAB-Bench** (Arabic OCR/doc-AI, ACL 2025) — [github](https://github.com/mbzuai-oryx/KITAB-Bench) ✅ the
  most directly relevant OCR yardstick.
- **SILMA "Arabic AI Benchmarks and Leaderboards"** catalog (HF blog, Mar 2025) — best single index of Arabic
  eval resources: [link](https://huggingface.co/blog/silma-ai/arabic-ai-benchmarks-and-leaderboards).
- **getomni-ai/ocr-leaderboard** (cost + accuracy across cloud VLMs) — [HF dataset](https://huggingface.co/datasets/getomni-ai/ocr-leaderboard).
- **olmOCR-bench** (English-only, reading-order/tables) — [HF dataset](https://huggingface.co/datasets/allenai/olmOCR-bench).
- **Open Arabic LLM Leaderboard (OALL)** — [HF space](https://huggingface.co/spaces/OALL/Open-Arabic-LLM-Leaderboard)
  (note: measures understanding, **not** translation — see Stage 3).
- **IslamicMMLU** (Islamic-knowledge eval) and **PalmX 2025** (Arabic+Islamic culture shared task).
- **HF: "Supercharge your OCR Pipelines with Open Models"** overview — [blog](https://huggingface.co/blog/ocr-open-models).
- Community/practitioner color for local VLM-OCR on Macs: r/LocalLLaMA threads and the
  [John6666/forum2 mac_arm digest](https://huggingface.co/datasets/John6666/forum2/blob/main/mac_arm_object_analysis_1.md).

---

## Recommended target architecture (per stage)

| Stage | Now | Recommended |
|---|---|---|
| OCR | Tesseract `ara` / Apple Vision + OpenCV split | **QARI-OCR (local, MLX)** default → **Gemini 2.0 Flash (cloud)** fallback; emit **Markdown** |
| Layout/footnotes | OpenCV divider, 84% fallback | VLM Markdown output (Baseer/Gemini); **Docling/Surya-layout** classifier as fallback; **validate RTL** |
| Marker scheme | bare `⚓` + global count | **indexed `[[FN-n]]`** + per-chunk **manifest**, positional check |
| Translation | Aya Expanse 8B (Ollama) | **Qwen3-14B / Command-R local** or **Claude/Gemini cloud** for doctrinal; **glossary + BM25-RAG**; **two-pass refine** |
| QA gate | count parity → draft_ready/needs_review | **manifest + positional footnote check** + **LLM-as-judge** (adequacy/fluency/placement); chrF/COMET optional |
| Publish | Google Docs API stub (no footnotes/TOC) | **Markdown `[^n]` → Pandoc → docx/PDF** (native footnotes + TOC); Docs export secondary |
| Serving | Ollama | Ollama (≤24 GB) or **MLX/LM Studio/Pico** (≥32 GB) |

## Three-book pilot shortlist (do these, in order)

0. **Check OpenITI / al-Shamela first** — if any of the 3 books already exists as clean digital Arabic text,
   skip OCR entirely for it (removes OCR error from sacred text).
1. **Swap OCR** to QARI-OCR (local) and A/B it against Gemini 2.0 Flash (cloud) on your 3 books; measure CER
   against one hand-corrected page per book. *(highest impact — see below)*
2. **Change the footnote marker** to indexed `[[FN-n]]` + a per-chunk manifest; retire the bare-count QA
   (fixes `KNOWN_ISSUES.md` #5).
3. **Upgrade the translator**: **Qwen3-14B** locally (best open translator in the aiXplain table) and/or
   **GPT-4o-mini / Claude / Gemini** on the hardest chapter; add a small glossary; run a second refinement
   pass; use the Al-Shamela 9-point prompt.
4. **Add Quran/hadith detect-and-replace**: match quotations against a trusted verified DB and substitute the
   canonical Arabic + approved English, outputting both. *(highest religious-accuracy impact)*
5. **Publish via Pandoc** (Markdown `[^n]` → .docx) to get real linked footnotes + TOC immediately; defer the
   Google Docs API footnote work.
6. **Add QA gates**: back-translation + embedding-similarity adequacy check, plus an LLM-as-judge
   footnote-placement rubric — replacing count-only gating.

### ⭐ Single highest-impact change
**Replace Tesseract/Apple-Vision + the OpenCV splitter with a VLM OCR that outputs structured Markdown
(QARI-OCR local, Gemini 2.0 Flash cloud fallback).** It fixes OCR accuracy, RTL reading order, and
body/footnote separation in one move — the three things `KNOWN_ISSUES.md` flags as fragile — and it feeds
clean Markdown into every downstream stage.

---

*Caveat: items marked ✅ were verified against primary sources (KITAB-Bench, QARI-OCR, the aiXplain
translation table read directly from the PDF, Baseer, Docling's RTL issues, and the Al-Shamela deployment
paper). Items marked ⚠️ are single-source and not independently re-checked (Doha-RAG uplift, Gemini OCR
$/page, IslamicMMLU, MLX-vs-Ollama numbers). Confirm those exact figures — and, critically, each tool's
**real RTL/Arabic behavior on actual Haydari pages** — before committing.*
