# Known Issues — Haydari Book Scripts

Status: **pre-pilot review**. The five book scripts run and the pipeline
plumbing works end-to-end, but the items below should be fixed (or at least
understood) before relying on the batch run. Findings come from a code review
plus a local test using a stub Ollama server, a generated 2-page PDF, and real
Tesseract OCR. Real Arabic OCR accuracy, real translation quality, and the
Google Docs output were **not** tested (dependencies unavailable here).

---

## Bugs (should fix)

### 1. `books/books_inventory.py` — ambiguous PDF matches are mislabeled `missing`
- **Where:** `choose_local_pdf` (`books_inventory.py:22-25`); report buckets (`:52`, `:72`).
- **Problem:** A title that matches **more than one** PDF returns `None`, so the
  book is marked `missing` even though its PDF is on disk. The `report["unclear"]`
  bucket is created but nothing is ever appended to it, so it is always empty.
- **Impact:** Genuinely-ambiguous books hide inside "missing"; you lose the
  signal that a human needs to disambiguate.
- **Reproduced:** Catalog title `risala` with two files (`risala_v1.pdf`,
  `risala_v2.pdf`) present → reported `missing`, `unclear: []`.
- **Fix direction:** Distinguish 0 matches (`missing`) from >1 matches
  (`unclear`) and populate the `unclear` bucket.

### 2. `books/run_batch.py` — QA-failed drafts get published anyway
- **Where:** `process_book.py:180-196` (exit code) + `run_batch.py:39-46` (publish).
- **Problem:** `books/process_book.py` exits `0` even when it sets status
  `needs_review` (footnote/anchor count mismatch). `books/run_batch.py` uses
  `subprocess.run(..., check=True)`, which treats exit 0 as success, so with
  `--publish` it proceeds to publish a draft that failed QA.
- **Impact:** The footnote-integrity check does not actually gate publishing.
- **Reproduced:** Stub translator that drops `⚓` → status `needs_review`,
  `books/process_book.py` exit code `0`.
- **Fix direction:** After processing, check the book's status (or
  `qa_report.json`) and only publish when it is `draft_ready`.

### 3. `books/run_batch.py` — cannot select an OCR engine; always uses Apple Vision
- **Where:** `run_batch.py:23`, `:33-37`.
- **Problem:** `books/run_batch.py` forwards `--ocr-command` to `books/process_book.py` but
  never sets `--ocr-engine`. `books/process_book.py` defaults the engine to `vision`
  and only *uses* the custom command when `engine == "command"`, so the
  forwarded `--ocr-command` is silently ignored and Vision is always attempted.
  There is no `--ocr-engine` argument on `books/run_batch.py` at all.
- **Impact:** On any machine without the Apple Vision Python bindings — including
  the Phase-3 Tesseract-vs-Vision comparison — every book in the batch fails.
- **Reproduced:** `run_batch.py --ocr-command "tesseract {image} stdout -l {lang}"`
  → `books/process_book.py` raised `Apple Vision Python bindings are unavailable`.
- **Fix direction:** Add `--ocr-engine` to `books/run_batch.py` and forward it (and set
  it to `command` automatically when `--ocr-command` is given).

---

## Gaps vs. the plan (incomplete, not wrong)

### 4. `books/publish_book_to_google.py` does not implement footnotes or the TOC
- **Where:** `publish_book_to_google.py:43`, `:52-54`.
- **Problem:** The docstring/plan promise real Google Docs footnotes, a native
  table of contents, and replacing each `⚓` with an actual footnote. The code
  only inserts the joined `body_en` text — `⚓` characters go in **literally**,
  and `notes_en` (the translated footnote text) is **never used**, so footnote
  content is silently dropped.
- **Impact:** This is the script the plan calls the pilot "proof point," and the
  core of it is still a stub. Currently produces a body-only doc with stray ⚓.
- **Also:** Inserting an entire book in one `insertText` batchUpdate may hit
  Google Docs API request-size limits on large books; will likely need chunking.

---

## Design risk (works as written, but fragile)

### 5. Footnote QA checks count parity only, through an 8B model
- **Where:** `process_book.py:173-187`.
- **Problem:** Markers are replaced with a bare `⚓` glyph, the text is sent
  through the local model, and QA compares the *count* of `⚓` in vs. out. Local
  8B models frequently drop, duplicate, or remove stray symbols, so
  `needs_review` may fire constantly; conversely, counts can match while anchors
  land in the wrong place.
- **Demonstrated:** QA reported `draft_ready` on completely garbled OCR text
  because the marker count happened to match — the check verifies count, not
  placement or correctness.
- **Fix direction:** Use an indexed, more robust marker (e.g. `[[FN17]]`) that
  can be verified positionally rather than only counted.

---

## Repo hygiene

### 6. `lecture_pipeline.py` is not a Python file
- **Problem:** Despite the `.py` extension, the file contents are **RTF**
  (rich-text) wrapping a shell heredoc (`cat > … <<'PY'`). It will not run as
  Python (`python lecture_pipeline.py` fails on line 1). It appears to have been
  saved out of TextEdit in Rich Text mode.
- **Note:** It is also a **different project** from the book pipeline —
  Arabic *audio-lecture* transcription (WhisperX + diarization) translated with
  `qwen2.5:3b`, unrelated to the five book scripts and not in the README. The
  embedded script is also still in test mode (`break`s after one lecture).
- **Fix direction:** Decide whether it belongs in this repo. If so, extract the
  real Python from the RTF and save it as plain text (and rename to reflect that
  it is a separate lecture pipeline).

---

## Environment notes (for the real pilot)

Confirmed present on the review machine: Poppler (`pdftoppm`), Tesseract 5.x with
the `ara` language pack, Pillow. **Missing** (needed for a real run): a running
Ollama with `aya-expanse:8b` (translation), Apple Vision Python bindings
(`pyobjc` Vision/Cocoa) for `--ocr-engine vision`, `google-api-python-client`
+ service-account credentials (publishing), and `opencv-python` (`cv2`) — the
latter is optional; without it footnote-divider detection falls back to a fixed
84% cut on every page.

## What was and was not tested
- **Tested (logic/plumbing):** inventory matching + DB build, archive sync,
  publish `--dry-run` text assembly, and the full `books/process_book.py` page loop
  (render → crop → body/notes split → Tesseract OCR → anchor substitution →
  translate via a stub → QA aggregation → SQLite update), plus `books/run_batch.py`
  selection and error-handling.
- **NOT tested (needs real dependencies / the three-book pilot):** Arabic OCR
  accuracy (test PDF used Latin filler text), real translation quality
  (translator was stubbed), and actual Google Docs creation/footnotes/TOC.
