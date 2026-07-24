// Wire types — these mirror ARCHITECTURE.md exactly.
// The frontend depends on this contract; adapters must not deviate from it.

export type SegmentKind = "body" | "footnote" | "sacred";
export type SegmentStatus = "draft" | "needs_review" | "approved";
export type ReviewAction = "approve" | "reject" | "skip";
export type Scope = "global" | "book";

// Book lifecycle status shown as a pill in the Library.
export type BookStatus = "uploaded" | "processing" | "in_review" | "published";

export interface SegmentQA {
  bt_sim: number | null;
  self_consistency: number | null;
  judge_score: number | null;
  judge_note: string | null;
  footnote_ok: boolean | null;
}

// Segment JSON (API wire format). See ARCHITECTURE.md §"Segment JSON".
export interface Segment {
  id: string;
  book_id: string;
  page: number;
  order: number;
  kind: SegmentKind;
  anchor: string | null;
  ar: string;
  en: string; // en_current — the text under review
  engine: string;
  confidence: number; // 0..1
  qa: SegmentQA;
  alternatives: string[];
  status: SegmentStatus;

  // Frontend-only extension used to render TRACKED CHANGES (ins/del).
  // Maps to segments.en_draft in the data model. When present and different
  // from `en`, the editor renders a word-level draft->current diff.
  en_draft?: string | null;
}

export interface Book {
  id: string;
  title_ar: string;
  title_en: string;
  author: string;
  status: BookStatus;
  page_count: number;
  progress: number; // 0..1 approved fraction across the book
}

// GET /books/{id}/status — ingestion/translation progress for the Library.
export interface IngestStatus {
  book_id: string;
  status: BookStatus;
  phase: "idle" | "ocr" | "translate" | "qa" | "done";
  pages_done: number;
  pages_total: number;
  progress: number; // 0..1
}

// Optional metadata attached to an upload.
export interface UploadMeta {
  title_ar?: string;
  title_en?: string;
  author?: string;
}

// POST /books/import — catalog entry.
export interface CatalogEntry {
  title_ar: string;
  title_en: string;
  author: string;
  source_pdf: string;
}

export interface PagePayload {
  book: Book;
  page: number;
  image_url: string | null;
  segments: Segment[];
}

// POST /segments/{id}/review
export interface ReviewScores {
  Adequacy: number;
  Fluency: number;
  Terminology: number;
  Footnotes: number;
}
export interface ReviewBody {
  en_edited: string;
  action: ReviewAction;
  scores: ReviewScores;
  mqm: string[];
}
export interface ReviewLearning {
  tm_added: boolean;
  terms_suggested: string[];
  applied_to: number;
}
export interface ReviewResult {
  status: SegmentStatus;
  learning: ReviewLearning;
}

// POST /termbase
export interface TermBody {
  term_ar: string;
  term_en: string;
  note: string;
  scope: Scope;
}

// POST /style-rules
export interface StyleRuleBody {
  rule: string;
  scope: Scope;
}

// GET /learning/summary
export interface LearningSummary {
  tm_size: number;
  terms: number;
  rules: number;
  auto_approval_rate: number;
  corrections: number;
}

export interface HaydariAPI {
  listBooks(): Promise<Book[]>;
  getBook(id: string): Promise<Book>;
  uploadBooks(files: File[], meta?: UploadMeta): Promise<{ id: string }[]>;
  importBooks(catalog: CatalogEntry[]): Promise<{ id: string }[]>;
  ingestBook(id: string): Promise<IngestStatus>;
  getBookStatus(id: string): Promise<IngestStatus>;
  importTermbase(file: File): Promise<{ imported: number }>;
  getPage(bookId: string, n: number): Promise<PagePayload>;
  getSegment(id: string): Promise<Segment>;
  reviewSegment(id: string, body: ReviewBody): Promise<ReviewResult>;
  addTerm(body: TermBody): Promise<{ ok: boolean }>;
  addStyleRule(body: StyleRuleBody): Promise<{ ok: boolean }>;
  learningSummary(): Promise<LearningSummary>;
}
