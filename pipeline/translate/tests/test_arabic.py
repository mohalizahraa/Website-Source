"""Normalisation-aware matching used by TM, canonical detection, and — since
the glossary optimisation — filtering which terms are injected per segment.

The correctness risk for the glossary filter is *under*-inclusion: a term wrongly
dropped because the source spells it with different diacritics/orthography would
silently stop enforcing that terminology. These tests pin the folding that
prevents that.
"""

from translate import arabic


def test_contains_ignores_diacritics_on_either_side():
    # Term carries full harakāt; OCR'd source has none (and vice versa).
    assert arabic.contains("اعلم أن المتكلمون قالوا", "المُتَكَلِّمُون")
    assert arabic.contains("درس المُتَكَلِّمُون", "المتكلمون")


def test_contains_folds_alef_and_hamza_variants():
    assert arabic.contains("في الاصول والفقه", "الأصول")   # bare alef ↔ hamza-alef
    assert arabic.contains("قال إبراهيم", "ابراهيم")


def test_contains_folds_ta_marbuta_and_alef_maqsura():
    assert arabic.contains("طلب الحقيقه", "الحقيقة")        # ة ↔ ه
    assert arabic.contains("إلى المعنى", "المعني")          # ى ↔ ي


def test_contains_matches_multiword_term():
    assert arabic.contains("هذا مذهب أهل السنة والجماعة", "أهل السنة")


def test_contains_ignores_tatweel_and_punctuation():
    assert arabic.contains("قال: «التوحيـــد» مهم", "التوحيد")


def test_empty_needle_never_matches():
    assert arabic.contains("أي نص", "") is False
    assert arabic.contains("أي نص", "   ") is False


def test_absent_term_does_not_match():
    assert arabic.contains("نص عن الفقه", "الطبيعة") is False
