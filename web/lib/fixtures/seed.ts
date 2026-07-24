// Local fixtures for the MOCK adapter.
//
// These mirror the eight segments in the approved design mockup, which in turn
// mirror server/seed.py. Values are expressed in the API wire format
// (confidence + qa metrics as 0..1 floats). The frontend converts to percents
// for display. Includes the sacred Qurʾān 57:3 (al-Ḥadīd) segment, which is
// locked and rendered from the canonical DB — never machine-translated.

import type { Book, PagePayload, Segment } from "../types";

const BOOK_ID = "B-01";
const PAGE = 42;

function segId(order: number): string {
  return `${BOOK_ID}:${String(PAGE).padStart(3, "0")}:${String(order).padStart(3, "0")}`;
}

export const BOOK: Book = {
  id: BOOK_ID,
  title_ar: "معارج التوحيد",
  title_en: "Ascents of Divine Unity",
  author: "al-Ḥaydarī",
  status: "in_review",
  page_count: 318,
  progress: 0.38,
};

// The Library — several books with varied lifecycle statuses so the Home
// screen exercises every pill/progress state offline.
export const LIBRARY: Book[] = [
  BOOK,
  {
    id: "B-02",
    title_ar: "مبادئ الحكمة الإلهية",
    title_en: "Principles of Divine Wisdom",
    author: "al-Ḥaydarī",
    status: "uploaded",
    page_count: 214,
    progress: 0,
  },
  {
    id: "B-03",
    title_ar: "شرح المنظومة في المنطق",
    title_en: "Commentary on the Logic Poem",
    author: "al-Sabzawārī",
    status: "processing",
    page_count: 402,
    progress: 0.17,
  },
  {
    id: "B-04",
    title_ar: "رسالة في الوجود الذهني",
    title_en: "Treatise on Mental Existence",
    author: "al-Ṭūsī",
    status: "published",
    page_count: 96,
    progress: 1,
  },
  {
    id: "B-05",
    title_ar: "الأسفار الأربعة — الجزء الأول",
    title_en: "The Four Journeys, Vol. I",
    author: "Mullā Ṣadrā",
    status: "in_review",
    page_count: 640,
    progress: 0.71,
  },
];

// Body + sacred segments (the review queue). Order matches the mockup.
export const SEGMENTS: Segment[] = [
  {
    id: segId(1),
    book_id: BOOK_ID,
    page: PAGE,
    order: 1,
    kind: "body",
    anchor: null,
    ar: "اعلَمْ أنَّ الوجودَ أظهرُ الأشياءِ تصوُّراً وأخفاها كُنهاً وحقيقةً.",
    en: "Know that existence is the most manifest of all things in conception, yet the most hidden of them in its innermost reality.",
    engine: "Qwen3-14B · local",
    confidence: 0.96,
    qa: {
      bt_sim: 0.97,
      self_consistency: 0.96,
      judge_score: 0.95,
      judge_note: "Clean. Terminology and register match your approved style.",
      footnote_ok: true,
    },
    alternatives: [],
    status: "approved",
  },
  {
    id: segId(2),
    book_id: BOOK_ID,
    page: PAGE,
    order: 2,
    kind: "body",
    anchor: null,
    ar: "وقد اختلفَ الحكماءُ في أنَّ الوجودَ زائدٌ على الماهيةِ أو عينُها.",
    en: "The sages differed as to whether existence is superadded to quiddity or identical with it.",
    engine: "Qwen3-14B · local",
    confidence: 0.81,
    qa: {
      bt_sim: 0.9,
      self_consistency: 0.88,
      judge_score: 0.82,
      judge_note:
        "Acceptable. “the sages” for الحكماء — confirm your preferred rendering.",
      footnote_ok: true,
    },
    alternatives: ["the philosophers", "the sages", "the theosophers (ḥukamāʾ)"],
    status: "needs_review",
  },
  {
    id: segId(3),
    book_id: BOOK_ID,
    page: PAGE,
    order: 3,
    kind: "body",
    anchor: null,
    ar: "فذهبَ المتكلّمونَ إلى أنَّ الوجودَ معنىً زائدٌ عارضٌ للماهيةِ في الخارج.",
    // Draft -> current produces the tracked-changes ins/del in the mockup.
    en_draft:
      "So the theologians held that existence is an added meaning, accidental to quiddity in the external world.",
    en: "So the mutakallimūn held that existence is a superadded meaning, accidental to quiddity in extramental reality.",
    engine: "Claude · cloud (escalated)",
    confidence: 0.61,
    qa: {
      bt_sim: 0.82,
      self_consistency: 0.71,
      judge_score: 0.68,
      judge_note:
        "Terminology: “theologians” is imprecise for المتكلّمون; register modernized vs. your approved style. Routed to cloud after low local confidence.",
      footnote_ok: true,
    },
    alternatives: [
      "the dialectical theologians (mutakallimūn)",
      "the scholastics",
      "the mutakallimūn",
    ],
    status: "needs_review",
  },
  {
    id: segId(4),
    book_id: BOOK_ID,
    page: PAGE,
    order: 4,
    kind: "body",
    anchor: null,
    ar: "إذ لو كان عينَها لكان إثباتُ وجودِ الشيءِ تحصيلاً للحاصل.",
    en: "For were it identical with quiddity, affirming a thing's existence would be the mere securing of what is already secured.",
    engine: "Qwen3-14B · local",
    confidence: 0.89,
    qa: {
      bt_sim: 0.93,
      self_consistency: 0.9,
      judge_score: 0.9,
      judge_note: "Strong. Idiom تحصيل الحاصل rendered per glossary.",
      footnote_ok: true,
    },
    alternatives: [],
    status: "approved",
  },
  {
    id: segId(5),
    book_id: BOOK_ID,
    page: PAGE,
    order: 5,
    kind: "body",
    anchor: null,
    ar: "ومحصَّلُ مذهبِهم يرجعُ إلى تمايزٍ اعتباريٍّ لا خارجيٍّ.",
    en: "The upshot of their doctrine returns to a distinction of reason, not one obtaining in the concrete entity.",
    engine: "Claude · cloud (escalated)",
    confidence: 0.66,
    qa: {
      bt_sim: 0.84,
      self_consistency: 0.74,
      judge_score: 0.7,
      judge_note:
        "Check “distinction of reason” for اعتباري — your glossary prefers “conceptual distinction.”",
      footnote_ok: true,
    },
    alternatives: [
      "a conceptual distinction",
      "a distinction of reason",
      "a mind-dependent distinction",
    ],
    status: "needs_review",
  },
  {
    id: segId(6),
    book_id: BOOK_ID,
    page: PAGE,
    order: 6,
    kind: "sacred",
    anchor: null,
    ar: "هُوَ الأوَّلُ وَالآخِرُ وَالظّاهِرُ وَالْباطِنُ ۖ وَهُوَ بِكُلِّ شَيْءٍ عَليمٌ",
    // Body text references the footnote via an indexed anchor, never a bare glyph.
    en: "He is the First and the Last, the Outward and the Inward; and He has knowledge of all things.[[FN-1]]",
    engine: "Canonical DB · substituted",
    confidence: 1,
    qa: {
      bt_sim: 1,
      self_consistency: 1,
      judge_score: 1,
      judge_note:
        "Qurʾānic quotation detected and matched to the canonical verse. Arabic and approved English are locked — never machine-translated.",
      footnote_ok: true,
    },
    alternatives: [],
    status: "approved",
  },
  {
    id: segId(7),
    book_id: BOOK_ID,
    page: PAGE,
    order: 7,
    kind: "body",
    anchor: null,
    ar: "ومِن هنا قال العارفون: ما عرفَ اللهَ إلّا اللهُ.",
    en: "From here the gnostics said: none knows God save God.",
    engine: "Qwen3-14B · local",
    confidence: 0.84,
    qa: {
      bt_sim: 0.91,
      self_consistency: 0.86,
      judge_score: 0.84,
      judge_note:
        "Confirm “gnostics” vs. “the knowers (ʿārifūn)” for consistency across the corpus.",
      footnote_ok: true,
    },
    alternatives: ["the knowers (ʿārifūn)", "the gnostics", "the mystics"],
    status: "needs_review",
  },
  {
    id: segId(8),
    book_id: BOOK_ID,
    page: PAGE,
    order: 8,
    kind: "body",
    anchor: null,
    ar: "وتمامُ الكلامِ فيه في محلِّه إن شاء الله.",
    en: "The full treatment of this belongs to its proper place, God willing.",
    engine: "Qwen3-14B · local",
    confidence: 0.76,
    qa: {
      bt_sim: 0.89,
      self_consistency: 0.8,
      judge_score: 0.8,
      judge_note: "Fine. Formulaic phrase matched to translation memory.",
      footnote_ok: true,
    },
    alternatives: [],
    status: "needs_review",
  },
  // Footnote segment (own kind). Rendered in the footnotes area, not the rail.
  {
    id: segId(9),
    book_id: BOOK_ID,
    page: PAGE,
    order: 9,
    kind: "footnote",
    anchor: "FN-1",
    ar: "القرآن، سورة الحديد ٥٧:٣.",
    en: "Qurʾān, Sūrat al-Ḥadīd 57:3. Rendered from the project's approved translation — not machine-translated.",
    engine: "Canonical DB · substituted",
    confidence: 1,
    qa: {
      bt_sim: 1,
      self_consistency: 1,
      judge_score: 1,
      judge_note: null,
      footnote_ok: true,
    },
    alternatives: [],
    status: "approved",
  },
];

export function buildPage(): PagePayload {
  return {
    book: BOOK,
    page: PAGE,
    image_url: null,
    // Deep clone so mutations in the mock adapter don't leak across reloads.
    segments: SEGMENTS.map((s) => ({ ...s, qa: { ...s.qa }, alternatives: [...s.alternatives] })),
  };
}
