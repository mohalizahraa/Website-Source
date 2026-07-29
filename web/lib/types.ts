// Wire types — these mirror ARCHITECTURE.md exactly.
// The frontend depends on this contract; adapters must not deviate from it.

// Authenticated user (wire shape from /api/auth/*). null = anonymous.
export type UserRole = "admin" | "creator" | "reader";
export interface User {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
}
// New-account payload for the admin "add user" screen.
export interface NewUser {
  email: string;
  password: string;
  display_name?: string;
  role?: UserRole;
}

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
  pages_total?: number; // physical pages in the source PDF (0 until known)
  translation_notes?: string | null; // per-book instructions injected into prompts
}

// Live, human-readable detail while a book is ingesting.
export interface IngestDetail {
  message?: string; // composed one-liner, e.g. "Translating page 7 · segment 3/8…"
  phase?: string; // rendering | ocr | translate | done | error
  page?: number | null; // page currently being processed
  seg?: number;
  seg_total?: number;
  index?: number; // page index within this run
  target_count?: number; // pages targeted this run
  done_this_run?: number;
  failed?: number[]; // pages that failed this run
  last_error?: string | null;
}

// GET /books/{id}/status — ingestion/translation progress for the Library.
export interface IngestStatus {
  book_id: string;
  status: BookStatus;
  phase: "idle" | "ocr" | "translate" | "qa" | "done";
  pages_done: number;
  pages_total: number;
  has_more: boolean; // true when pages remain to ingest (enables "Continue")
  progress: number; // 0..1 ingest completion (pages_done / pages_total)
  detail?: IngestDetail; // live per-page/segment feedback
}

// Bounds for one ingest run.
export interface IngestOptions {
  from_page?: number;
  to_page?: number;
  max_pages?: number;
  force?: boolean; // re-do already-finished pages in the range
}

// Optional metadata attached to an upload.
export interface UploadMeta {
  title_ar?: string;
  title_en?: string;
  author?: string;
  notes?: string; // per-book translation instructions
}

// POST /chat
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
export interface ChatAction {
  tool: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}
export interface ChatResult {
  reply: string;
  actions: ChatAction[];
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
  book_id?: string;
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
  // --- auth ---
  me(): Promise<User | null>;
  login(email: string, password: string): Promise<User>;
  logout(): Promise<{ ok: boolean }>;
  createUser(body: NewUser): Promise<User>;

  listBooks(): Promise<Book[]>;
  getBook(id: string): Promise<Book>;
  deleteBook(id: string): Promise<{ ok: boolean }>;
  updateBook(id: string, patch: { translation_notes?: string }): Promise<Book>;
  uploadBooks(files: File[], meta?: UploadMeta): Promise<{ id: string }[]>;
  importBooks(catalog: CatalogEntry[]): Promise<{ id: string }[]>;
  ingestBook(id: string, options?: IngestOptions): Promise<IngestStatus>;
  getBookStatus(id: string): Promise<IngestStatus>;
  listPages(id: string): Promise<number[]>;
  chat(messages: ChatMessage[], bookId?: string): Promise<ChatResult>;
  importTermbase(file: File): Promise<{ imported: number }>;
  getPage(bookId: string, n: number): Promise<PagePayload>;
  getSegment(id: string): Promise<Segment>;
  reviewSegment(id: string, body: ReviewBody): Promise<ReviewResult>;
  addTerm(body: TermBody): Promise<{ ok: boolean }>;
  addStyleRule(body: StyleRuleBody): Promise<{ ok: boolean }>;
  learningSummary(): Promise<LearningSummary>;
}
