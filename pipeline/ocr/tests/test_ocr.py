"""Unit tests for the Haydari OCR pipeline. All run fully offline via the mock.

Proves the ARCHITECTURE.md contract:
* indexed ``[[FN-n]]`` anchors are emitted in body text and matched to footnote
  segments that carry ``anchor = "FN-n"``;
* sacred lines (Qurʾan 57:3, a Hadith) are flagged ``kind == "sacred"``;
* the body / footnote split works on the fabricated fixture.
"""

from __future__ import annotations

import re

import pytest

from pipeline.ocr import (
    KIND_BODY,
    KIND_FOOTNOTE,
    KIND_SACRED,
    MockOcrEngine,
    OcrBlock,
    OcrError,
    QariOcrEngine,
    GeminiOcrEngine,
    check_anchors,
    classify,
    detect_sacred,
    emit_markdown,
    normalize_markers,
    process_page,
    select_engine,
)
from pipeline.ocr.engines import blocks_from_markdown


@pytest.fixture
def page():
    # Mock ignores the pixels; any path is fine.
    return process_page("nonexistent.png", engine=MockOcrEngine())


# --------------------------------------------------------------------------- #
# Contract shape                                                              #
# --------------------------------------------------------------------------- #
def test_process_page_shape(page):
    assert set(page) >= {"markdown", "segments", "confidence"}
    assert isinstance(page["markdown"], str)
    for seg in page["segments"]:
        assert set(seg) >= {"order", "kind", "ar", "anchor"}
        assert seg["kind"] in {KIND_BODY, KIND_FOOTNOTE, KIND_SACRED}
    orders = [s["order"] for s in page["segments"]]
    assert orders == list(range(len(orders)))  # contiguous reading order


def test_eight_segments(page):
    # 4 body + 2 sacred + 2 footnotes = 8 (divider is not a segment).
    assert len(page["segments"]) == 8


# --------------------------------------------------------------------------- #
# Body / footnote split                                                       #
# --------------------------------------------------------------------------- #
def test_body_footnote_split(page):
    kinds = [s["kind"] for s in page["segments"]]
    assert kinds.count(KIND_FOOTNOTE) == 2
    assert kinds.count(KIND_BODY) == 4
    assert kinds.count(KIND_SACRED) == 2
    # Footnotes come last in reading order.
    footnote_orders = [s["order"] for s in page["segments"] if s["kind"] == KIND_FOOTNOTE]
    assert footnote_orders == [6, 7]


def test_divider_splits_regions():
    blocks = [
        OcrBlock("متن أول", region="body"),
        OcrBlock("____", region="divider"),
        OcrBlock("(١) حاشية", region="notes"),
    ]
    segs = classify(blocks)
    assert [s.kind for s in segs] == [KIND_BODY, KIND_FOOTNOTE]


# --------------------------------------------------------------------------- #
# Anchors: emitted and matched                                                #
# --------------------------------------------------------------------------- #
def test_body_anchors_emitted(page):
    body_text = " ".join(s["ar"] for s in page["segments"] if s["kind"] != KIND_FOOTNOTE)
    assert "[[FN-1]]" in body_text
    assert "[[FN-2]]" in body_text
    # No bare glyph markers left behind.
    assert "(١)" not in body_text and "(٢)" not in body_text


def test_footnote_anchors_matched(page):
    footnotes = {s["anchor"]: s for s in page["segments"] if s["kind"] == KIND_FOOTNOTE}
    assert set(footnotes) == {"FN-1", "FN-2"}
    # Every body reference has a matching footnote segment, and vice versa.
    body_refs = set(re.findall(r"\[\[(FN-\d+)\]\]", page["markdown"]))
    footnote_anchors = set(footnotes)
    assert body_refs == footnote_anchors


def test_markdown_contains_anchor_and_footnote_line(page):
    md = page["markdown"]
    assert "[[FN-1]]" in md
    # Footnote target line is prefixed with its own anchor.
    assert re.search(r"\[\[FN-1\]\]\s+\S", md)
    # Divider separates body from footnotes.
    assert "---" in md


def test_normalize_markers_arabic_and_ascii():
    assert normalize_markers("نص (١).") == "نص [[FN-1]]."
    assert normalize_markers("text [12].") == "text [[FN-12]]."


# --------------------------------------------------------------------------- #
# Sacred flagging                                                             #
# --------------------------------------------------------------------------- #
def test_sacred_flagged(page):
    from pipeline.ocr.classifier import _strip_tashkeel

    sacred = [s for s in page["segments"] if s["kind"] == KIND_SACRED]
    assert len(sacred) == 2
    joined = _strip_tashkeel(" ".join(s["ar"] for s in sacred))
    assert "الاول والاخر" in joined.replace("ٱ", "ا").replace("أ", "ا").replace("آ", "ا")  # Qurʾan 57:3
    assert "عرف نفسه" in joined  # Hadith


def test_detect_sacred_quran_by_known_verse():
    assert detect_sacred("﴿هو الأول والآخر والظاهر والباطن﴾") == "quran"


def test_detect_sacred_hadith_marker():
    assert detect_sacred("قال رسول الله: إنما الأعمال بالنيات") == "hadith"


def test_detect_sacred_none_on_plain_body():
    assert detect_sacred("وذهب المتكلمون إلى وجوب النظر") is None


# --------------------------------------------------------------------------- #
# Confidence for the router                                                   #
# --------------------------------------------------------------------------- #
def test_confidence_present_and_deterministic(page):
    assert 0.0 <= page["confidence"] <= 1.0
    again = process_page("x.png", engine=MockOcrEngine())
    assert again["confidence"] == page["confidence"]
    assert again["segments"] == page["segments"]
    # Sacred lines carry lower confidence (worth escalating).
    for seg in page["segments"]:
        assert "confidence" in seg


# --------------------------------------------------------------------------- #
# RTL handling                                                                #
# --------------------------------------------------------------------------- #
def test_rtl_text_intact(page):
    # Arabic characters survive untouched (no reshaping / reordering).
    assert "المتكلّمون" in page["markdown"]


# --------------------------------------------------------------------------- #
# Engine selection + stubs                                                    #
# --------------------------------------------------------------------------- #
def test_default_engine_is_mock(monkeypatch):
    monkeypatch.delenv("HAYDARI_OCR_ENGINE", raising=False)
    monkeypatch.delenv("QARI_MODEL_PATH", raising=False)
    assert isinstance(select_engine(), MockOcrEngine)


def test_qari_not_configured_raises(monkeypatch):
    monkeypatch.delenv("QARI_MODEL_PATH", raising=False)
    with pytest.raises(OcrError, match="not configured"):
        QariOcrEngine().recognize("page.png")


def test_gemini_not_configured_raises(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with pytest.raises(OcrError, match="not configured"):
        GeminiOcrEngine().recognize("page.png")


def test_unknown_engine_raises():
    with pytest.raises(OcrError, match="Unknown OCR engine"):
        select_engine("does-not-exist")


# --------------------------------------------------------------------------- #
# Markdown-parsing helper used by real adapters                               #
# --------------------------------------------------------------------------- #
def test_blocks_from_markdown_divider():
    md = "متن أول\n\n---\n\n(١) حاشية"
    blocks = blocks_from_markdown(md)
    regions = [b.region for b in blocks]
    assert regions == ["body", "divider", "notes"]


# --------------------------------------------------------------------------- #
# Regression: anchor cross-check (body refs vs footnote anchors)              #
# --------------------------------------------------------------------------- #
def test_anchor_mismatch_is_surfaced_not_silent():
    # Body references FN-2 but the only footnote is FN-1: an off-by-one that
    # must NOT be emitted silently (previously it was).
    segs = classify([
        OcrBlock("متن (٢)", region="body"),
        OcrBlock("____", region="divider"),
        OcrBlock("(١) حاشية", region="notes"),
    ])
    report = check_anchors(segs)
    assert report["ok"] is False
    assert report["body_orphans"] == [2]
    assert report["footnote_orphans"] == [1]


def test_process_page_flags_anchor_mismatch():
    engine = MockOcrEngine(fixture=_write_fixture(
        [
            {"text": "متن (٢)", "region": "body"},
            {"text": "____", "region": "divider"},
            {"text": "(١) حاشية", "region": "notes"},
        ]
    ))
    page = process_page("x.png", engine=engine)
    assert page["anchor_mismatch"] is not None
    assert page["anchor_mismatch"]["body_orphans"] == [2]
    assert page["anchor_mismatch"]["footnote_orphans"] == [1]


def test_matched_anchors_report_ok(page):
    # The fabricated fixture is internally consistent (FN-1, FN-2 both sides).
    assert page["anchor_mismatch"] is None
    segs = classify(MockOcrEngine().recognize("x.png").blocks)
    report = check_anchors(segs)
    assert report["ok"] is True
    assert report["body_refs"] == [1, 2]
    assert report["footnote_anchors"] == [1, 2]


def test_duplicate_footnote_anchor_flagged():
    segs = classify([
        OcrBlock("متن (١)", region="body"),
        OcrBlock("____", region="divider"),
        OcrBlock("(١) حاشية أولى", region="notes"),
        OcrBlock("(١) حاشية ثانية", region="notes"),
    ])
    report = check_anchors(segs)
    assert report["ok"] is False
    assert report["duplicate_footnotes"] == [1]


# --------------------------------------------------------------------------- #
# Regression: Arabic-Indic digits inside a pre-formed [[FN-n]] anchor          #
# --------------------------------------------------------------------------- #
def test_preformed_anchor_arabic_digits_normalized():
    # A VLM may already emit [[FN-٣]]; it must become ASCII [[FN-3]].
    assert normalize_markers("متن [[FN-٣]]") == "متن [[FN-3]]"


def test_preformed_anchor_lines_up_with_footnote():
    segs = classify([
        OcrBlock("متن [[FN-٣]]", region="body"),
        OcrBlock("____", region="divider"),
        OcrBlock("(٣) حاشية", region="notes"),
    ])
    body = " ".join(s.ar for s in segs if s.kind != KIND_FOOTNOTE)
    assert "[[FN-3]]" in body
    assert "[[FN-٣]]" not in body  # no Arabic-Indic digits left in anchors
    report = check_anchors(segs)
    assert report["ok"] is True  # body FN-3 matches footnote FN-3


def _write_fixture(blocks):
    """Helper: write a temp fixture and return its path (for engine tests)."""
    import json
    import tempfile

    fd = tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, encoding="utf-8"
    )
    json.dump({"page_confidence": 0.8, "blocks": blocks}, fd, ensure_ascii=False)
    fd.close()
    return fd.name


def test_emit_markdown_without_rtl_mark():
    segs = classify([
        OcrBlock("نص (١)", region="body"),
        OcrBlock("____", region="divider"),
        OcrBlock("(١) حاشية", region="notes"),
    ])
    md = emit_markdown(segs, rtl_mark=False)
    assert md.startswith("نص [[FN-1]]")
    assert "[[FN-1]] حاشية" in md
