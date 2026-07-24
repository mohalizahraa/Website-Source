# QA stage — `pipeline/qa`

Automatic quality gate for translated segments. Public contract
(`ARCHITECTURE.md`):

```python
score_segment(seg) -> {
  "bt_sim": float,            # back-translation adequacy (cosine)
  "self_consistency": float,  # engine stability across samples
  "judge_score": float,       # weighted MQM rubric from an LLM-as-judge
  "judge_note": str,          # short human-readable rationale
  "footnote_ok": bool,        # positional footnote verification
  "status": str,              # "approved" | "needs_review"
}
```

`seg` is a Segment dict in the wire format (`ar`, `en`, `kind`, `anchor`, …).
The English field may be `en`, `en_current`, or `en_draft` (DB shape) — all are
accepted.

## Why this stage exists — beating the old count-only check

The legacy pipeline (`books/process_book.py`) approved a page whenever the
**count** of footnote markers matched:

```python
status = "draft_ready" if source_anchors == draft_anchors else "needs_review"
```

That passes garbled or reordered text as long as the number of markers is right.
This stage treats each `[[FN-n]]` as an indexed, **positionally-verifiable**
anchor and checks that every source anchor (1) survives, (2) keeps its relative
order, and (3) stays attached to the correct clause. Demonstration:

| case                       | legacy (count-only) | this stage    |
|----------------------------|---------------------|---------------|
| good translation           | draft_ready         | **approved**  |
| anchors swapped (`FN-2`↔`FN-1`, count still matches) | draft_ready | **needs_review** |
| off-topic translation      | draft_ready         | **needs_review** |

## The five signals

1. **Back-translation adequacy** — `bt_sim = cosine(embed(ar), embed(back_translate(en)))`.
   The back-translator is a **different** engine from the one that produced the
   segment (per the architecture). A faithful draft reconstructs Arabic close to
   the source (high cosine); an off-topic one does not.
2. **Self-consistency** — the ar→en engine is sampled twice; the divergence of
   the two samples is a stability score. Soft guard.
3. **LLM-as-judge** — an MQM rubric (`adequacy`, `fluency`, `terminology`,
   `footnote_placement`) plus a short `judge_note`. Weighted into `judge_score`.
   *Note:* the mock judge only **counts** footnotes (like a naive LLM), so it is
   deliberately fooled by the swap case — the authoritative placement catch is
   the deterministic checker in `footnotes.py`. This layering is intentional: we
   never rely on the judge alone for placement.
4. **Footnote positional check** (`footnotes.check_footnotes`) — survival +
   order + **clause**-placement + **token**-placement. The token-position check
   catches an anchor that drifts *within* a single clause (where the clause
   index is unchanged). Both drift bounds are inclusive (drift == tolerance is
   rejected). This is the key improvement.
5. **Gating** — a normal segment is `approved` only if `bt_sim`, `judge_score`
   **and** footnote placement all pass their thresholds. Additional hard guards:
   a **degenerate guard** (empty / whitespace / anchor-only source or
   translation is never approved) and a hard **adequacy floor** (the MQM
   adequacy dimension must clear `adequacy_min` on its own — averaging cannot
   hide a fragmentary translation). Self-consistency is an extra soft guard. A
   `sacred` segment is `approved` only if it exactly matches the canonical
   Qurʾān/Hadith store (`canonical-match = true`); otherwise `needs_review` —
   sacred text is never approved on MT scores alone.

## Everything runs offline

Each external model sits behind an interface (`interfaces.py`) with a
deterministic mock (`mocks.py`), so the whole gate runs with no API keys and no
network. Real adapters (cloud embeddings, Claude/Gemini, a real canonical DB)
implement the same protocols and are injected via `QADeps`:

```python
from pipeline.qa import score_segment
from pipeline.qa.scoring import QADeps

deps = QADeps.default()          # all offline mocks
# deps.embedder = RealEmbedder(...)   # swap in production adapters later
out = score_segment(seg, deps=deps)
```

Thresholds live in `config.py` (`Thresholds`) and can be overridden per call.

## Files

| file            | purpose                                             |
|-----------------|-----------------------------------------------------|
| `scoring.py`    | `score_segment`, `QADeps`, gating logic             |
| `footnotes.py`  | positional anchor verification (the key improvement)|
| `interfaces.py` | `Embedder` / `Translator` / `Judge` / `CanonicalStore` protocols |
| `mocks.py`      | deterministic offline mocks + bilingual lexicon     |
| `config.py`     | `Thresholds`                                        |
| `tests/`        | pytest suite incl. the adversarial footnote case    |

## Running

From the repository root (`haydari/`):

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r pipeline/qa/requirements.txt
python -m pytest pipeline/qa/tests -v
```

## Assumptions

- Body footnote references use the architecture's `[[FN-n]]` scheme; a footnote
  segment carries `anchor = "FN-n"`.
- The mock bilingual lexicon covers the Islamic-theology pilot vocabulary; real
  adapters remove that limitation. Mock test data uses lexicon vocabulary so
  `bt_sim` is meaningful.
- Clause boundaries are detected on `. ! ? ؟ ؛ ; ، ,`. Placement tolerance
  (`footnote_clause_tol`) allows minor reordering within a clause while
  rejecting cross-clause moves and anchor swaps.
- Sacred gating requires an **exact** match against the canonical store; upstream
  `translate` is expected to have done detect-and-replace, so an exact match is
  the correct expectation here.
