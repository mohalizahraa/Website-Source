#!/usr/bin/env python3
"""Create the DB and insert one sample book + page 42 with eight segments.

Mirrors the review-workbench mockup so the frontend has real data to render.
Includes the sacred Qurʾān 57:3 segment (kind=sacred) and a body segment
carrying a [[FN-1]] anchor plus its matching footnote segment (anchor=FN-1).

Run:  python -m server.seed        (from repo root)
  or:  python seed.py              (from server/)

Idempotent: it wipes and recreates the sample rows each run.
"""
from __future__ import annotations

import json
import os
import sys

# Allow running as either `python -m server.seed` or `python seed.py`.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import config, db  # noqa: E402
from app.events import write_event  # noqa: E402

BOOK_ID = "B-01"
PAGE = 1


def _alts(*items: str) -> str:
    return json.dumps(list(items), ensure_ascii=False)


# id, order, kind, anchor, ar, en_draft, en_current, engine, confidence,
# bt_sim, self_consistency, judge_score, judge_note, footnote_ok, alternatives, status
SEGMENTS = [
    (
        f"{BOOK_ID}:042:01", 1, "body", None,
        "الحمد لله رب العالمين، وبه نستعين على أمور الدنيا والدين.",
        "Praise be to God, Lord of the worlds, and by Him we seek help in the affairs of this world and of religion.",
        "Praise be to God, Lord of the worlds, and by Him we seek help in the affairs of this world and of religion.",
        "local-qari", 0.93, 0.91, 0.88, 0.90,
        "Clean opening doxology; terminology consistent.", 1,
        _alts("All praise belongs to God, Lord of all the worlds."),
        "approved",
    ),
    (
        f"{BOOK_ID}:042:02", 2, "body", None,
        "اعلم أنّ التوحيد هو أصل الأصول، وعليه مدار مسائل الإلهيّات.",
        "Know that divine unity (tawḥīd) is the root of roots, and upon it turns the whole range of metaphysical questions.",
        "Know that divine unity (tawḥīd) is the root of roots, and upon it turns the whole range of metaphysical questions.",
        "claude-cloud", 0.74, 0.83, 0.77, 0.79,
        "Terminology: 'tawḥīd' correctly glossed; 'ilāhiyyāt' rendered as metaphysics.", 1,
        _alts(
            "Know that oneness (tawḥīd) is the foundation of foundations.",
            "the principle of principles",
        ),
        "needs_review",
    ),
    (
        f"{BOOK_ID}:042:03", 3, "body", None,
        "فذهب المتكلّمون إلى أنّ صفاته زائدة على ذاته، وخالفهم الفلاسفة في ذلك.",
        "So the mutakallimūn held that His attributes are superadded to His essence, and the philosophers opposed them on this.",
        "So the mutakallimūn held that His attributes are superadded to His essence, and the philosophers opposed them on this.",
        "claude-cloud", 0.61, 0.82, 0.71, 0.68,
        "Terminology: consider 'dialectical theologians' for mutakallimūn; check 'superadded'.", 1,
        _alts(
            "the dialectical theologians (mutakallimūn)",
            "the scholastics",
        ),
        "needs_review",
    ),
    (
        f"{BOOK_ID}:042:04", 4, "sacred", None,
        "هُوَ الْأَوَّلُ وَالْآخِرُ وَالظَّاهِرُ وَالْبَاطِنُ ۖ وَهُوَ بِكُلِّ شَيْءٍ عَلِيمٌ",
        "He is the First and the Last, the Outward and the Inward, and He has full knowledge of all things.",
        "He is the First and the Last, the Outward and the Inward, and He has full knowledge of all things.",
        "canonical-quran", 1.0, 1.0, 1.0, 1.0,
        "Sacred: Qurʾān 57:3 — detect-and-replace with canonical text and approved translation.", 1,
        _alts(),
        "approved",
    ),
    (
        f"{BOOK_ID}:042:05", 5, "body", None,
        "وقد استدلّ بهذه الآية على إحاطة علمه تعالى بالكلّيّات والجزئيّات جميعًا. [[FN-1]]",
        "This verse has been adduced as proof that His knowledge, exalted is He, encompasses both universals and particulars alike. [[FN-1]]",
        "This verse has been adduced as proof that His knowledge, exalted is He, encompasses both universals and particulars alike. [[FN-1]]",
        "claude-cloud", 0.66, 0.80, 0.72, 0.70,
        "Footnote anchor [[FN-1]] present and correctly attached to the sentence it modifies.", 1,
        _alts(
            "encompasses universals and particulars together",
        ),
        "needs_review",
    ),
    (
        f"{BOOK_ID}:042:06", 6, "body", None,
        "وهذا هو المذهب الحقّ الذي عليه المحقّقون من أهل النظر.",
        "This is the true position, upheld by the verifiers among the people of rational inquiry.",
        "This is the true position, upheld by the verifiers among the people of rational inquiry.",
        "local-qari", 0.71, 0.79, 0.74, 0.73,
        "Terminology: 'muḥaqqiqūn' as 'verifiers' is consistent with the termbase.", 1,
        _alts("the investigators", "those who have realized the truth"),
        "needs_review",
    ),
    (
        f"{BOOK_ID}:042:07", 7, "footnote", "FN-1",
        "انظر: صدر الدين الشيرازي، الأسفار الأربعة، ج٦، ص١٨٠؛ والطباطبائي، نهاية الحكمة، المرحلة الثانية عشرة.",
        "See: Ṣadr al-Dīn al-Shīrāzī, al-Asfār al-Arbaʿa, vol. 6, p. 180; and al-Ṭabāṭabāʾī, Nihāyat al-Ḥikma, the twelfth stage.",
        "See: Ṣadr al-Dīn al-Shīrāzī, al-Asfār al-Arbaʿa, vol. 6, p. 180; and al-Ṭabāṭabāʾī, Nihāyat al-Ḥikma, the twelfth stage.",
        "claude-cloud", 0.69, 0.78, 0.70, 0.72,
        "Footnote FN-1: bibliographic citation; transliteration of titles preserved.", 1,
        _alts(),
        "needs_review",
    ),
    (
        f"{BOOK_ID}:042:08", 8, "body", None,
        "وسيأتي تفصيل الكلام في ذلك في الفصل الآتي إن شاء الله تعالى.",
        "A detailed discussion of this will come in the following chapter, God the Exalted willing.",
        "A detailed discussion of this will come in the following chapter, God the Exalted willing.",
        "local-qari", 0.82, 0.86, 0.80, 0.81,
        "Fluent closing; 'in shāʾ Allāh' idiomatically rendered.", 1,
        _alts("if God the Exalted wills"),
        "draft",
    ),
]


def seed(conn) -> None:
    db.init_db(conn)

    # Clean any prior sample rows (cascades to pages/segments/corrections).
    conn.execute("DELETE FROM books WHERE id = ?", (BOOK_ID,))
    conn.execute(
        "DELETE FROM translation_memory WHERE book_id = ?", (BOOK_ID,)
    )

    conn.execute(
        """
        INSERT INTO books (id, title_ar, title_en, author, status, source_pdf,
                           google_doc_url)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            BOOK_ID,
            "معارج التوحيد",
            "Ascents of Divine Unity",
            "al-Ḥaydarī",
            "in_review",
            "books/B-01/source.pdf",
            None,
        ),
    )

    conn.execute(
        """
        INSERT INTO pages (book_id, page_no, image_path, ocr_markdown, status)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            BOOK_ID,
            PAGE,
            f"/static/{BOOK_ID}/pages/{PAGE:03d}.png",
            "# Page 42\n\nOCR markdown with [[FN-1]] anchor preserved.",
            "in_review",
        ),
    )

    for row in SEGMENTS:
        (
            sid, order, kind, anchor, ar, en_draft, en_current, engine,
            confidence, bt_sim, self_consistency, judge_score, judge_note,
            footnote_ok, alternatives, status,
        ) = row
        conn.execute(
            """
            INSERT INTO segments
                (id, book_id, page_no, seg_order, kind, anchor, ar,
                 en_draft, en_current, engine, confidence, bt_sim,
                 self_consistency, judge_score, judge_note, footnote_ok,
                 alternatives, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sid, BOOK_ID, PAGE, order, kind, anchor, ar, en_draft,
                en_current, engine, confidence, bt_sim, self_consistency,
                judge_score, judge_note, footnote_ok, alternatives, status,
            ),
        )
        # Seed TM from already-approved segments so it isn't empty at start.
        if status == "approved":
            db.upsert_tm(conn, book_id=BOOK_ID, ar=ar, en_approved=en_current)

    # A couple of glossary + style seeds to make /learning/summary meaningful.
    db.insert_term(
        conn, term_ar="التوحيد", term_en="divine unity (tawḥīd)",
        note="Core doctrine; keep transliteration in parentheses on first use.",
        scope="global", book_id=None, created_by="seed",
    )
    db.insert_term(
        conn, term_ar="المتكلّمون", term_en="mutakallimūn",
        note="Dialectical theologians; keep transliteration.",
        scope="book", book_id=BOOK_ID, created_by="seed",
    )
    db.insert_style_rule(
        conn,
        rule="On first occurrence, gloss technical Arabic terms with an italic transliteration in parentheses.",
        scope="global", book_id=None,
    )

    write_event(
        conn, actor="seed", type="seed.load",
        payload={"book_id": BOOK_ID, "page": PAGE, "segments": len(SEGMENTS)},
    )
    conn.commit()


def main() -> None:
    path = config.db_path()
    conn = db.connect(path)
    try:
        seed(conn)
    finally:
        conn.close()
    print(f"Seeded {len(SEGMENTS)} segments for {BOOK_ID} page {PAGE} into {path}")


if __name__ == "__main__":
    main()
