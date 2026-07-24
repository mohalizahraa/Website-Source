"""Sacred detect-and-replace: canonical substitution, never machine translation."""

import pytest

from translate import (
    MockCanonicalDB,
    MockTranslator,
    Pipeline,
    RecordingTranslator,
    substitute_sacred,
)

# Qurʾān 57:3 as it might arrive from OCR — same words, lighter diacritics.
QURAN_57_3_OCR = "هو الأول والآخر والظاهر والباطن وهو بكل شيء عليم"
# Ṣaḥīḥ al-Bukhārī 1
HADITH_OCR = "إنما الأعمال بالنيات"


def _forbidden_pipeline():
    """Pipeline whose MT engines raise if ever called."""
    forbid = RecordingTranslator(MockTranslator("mt"), forbid=True)
    return Pipeline(local=forbid, cloud=forbid, canonical_db=MockCanonicalDB()), forbid


def test_sacred_quran_replaced_from_canonical_db_not_mt():
    pipe, forbid = _forbidden_pipeline()
    seg = {"id": "B-1:005:02", "kind": "sacred", "ar": QURAN_57_3_OCR}
    out = pipe.translate_segment(seg, {})

    assert out["engine"] == "canonical"
    assert forbid.calls == 0  # the MT engine was never touched
    # Approved English is emitted...
    assert "He is the First and the Last" in out["en"]
    # ...alongside the canonical Arabic and reference (both AR + EN).
    assert "الْأَوَّل" in out["en"]
    assert "Qurʾān 57:3" in out["en"]
    assert out["confidence"] >= 0.6
    # Segment's Arabic is corrected to the verified canonical text.
    assert seg["ar"] != QURAN_57_3_OCR
    assert seg.get("canonical_ref") == "Qurʾān 57:3"


def test_sacred_hadith_replaced_from_canonical_db():
    pipe, forbid = _forbidden_pipeline()
    seg = {"kind": "sacred", "ar": HADITH_OCR}
    out = pipe.translate_segment(seg, {})
    assert out["engine"] == "canonical"
    assert forbid.calls == 0
    assert "Actions are but by intentions." in out["en"]
    assert "Bukhārī" in out["en"]


def test_substitute_sacred_returns_none_when_no_match():
    db = MockCanonicalDB()
    seg = {"kind": "sacred", "ar": "هذا نص عادي لا يوجد في قاعدة البيانات المقدسة"}
    assert substitute_sacred(seg, db) is None


def test_tiny_fragment_does_not_false_match_full_verse():
    # REGRESSION (bug 3): a 2-char fragment that is a substring of a verse must
    # NOT trigger a full-verse canonical substitution.
    db = MockCanonicalDB()
    assert db.match("هو") is None          # appears in Qurʾān 57:3 but far too short
    assert db.match("الأعمال") is None      # single word from the hadith
    # A genuine full-verse OCR (diacritics stripped) still matches.
    hit = db.match(QURAN_57_3_OCR)
    assert hit is not None and hit.ref == "Qurʾān 57:3"


def test_unmatched_sacred_is_never_machine_translated():
    # REGRESSION (bug 1): a sacred verse absent from the canonical DB must NOT
    # fall through to any MT engine — it is flagged for human review instead.
    forbid = RecordingTranslator(MockTranslator("mt"), forbid=True)
    pipe = Pipeline(local=forbid, cloud=forbid, canonical_db=MockCanonicalDB())
    seg = {"kind": "sacred", "ar": "جملة مقدسة غير موجودة في القاعدة إطلاقا"}
    out = pipe.translate_segment(seg, {})

    assert forbid.calls == 0  # no Translator was ever invoked for sacred text
    assert out["engine"] == "canonical-missing"
    assert out["en"] == ""  # left untranslated on purpose
    assert out["status"] == "needs_review"
    assert out["needs_canonical"] is True


def test_router_canonical_tier_never_machine_translated():
    # REGRESSION (bug 1, defensive): if a "canonical" tier ever reaches the MT
    # stage, it must route to review, not silently machine-translate.
    from translate import Router

    forbid = RecordingTranslator(MockTranslator("mt"), forbid=True)

    class AlwaysCanonical(Router):
        def initial_tier(self, seg):
            from translate.types import RouteDecision

            return RouteDecision(engine="canonical", tier="canonical", reason="forced")

    # kind != sacred so it bypasses step 1 and reaches the routing stage.
    pipe = Pipeline(local=forbid, cloud=forbid, router=AlwaysCanonical())
    out = pipe.translate_segment({"kind": "body", "ar": "نص عادي"}, {})
    assert forbid.calls == 0
    assert out["engine"] == "canonical-missing"
    assert out["status"] == "needs_review"
