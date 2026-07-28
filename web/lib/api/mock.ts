// MOCK adapter — deterministic in-memory implementation of HaydariAPI.
// Lets the whole app (Library + workbench) run standalone with no backend.
// Mutations persist for the life of the page (module singleton) so uploads,
// ingestion progress, edits and approvals feel real.

import type {
  Book,
  CatalogEntry,
  ChatMessage,
  ChatResult,
  HaydariAPI,
  IngestOptions,
  IngestStatus,
  LearningSummary,
  PagePayload,
  ReviewBody,
  ReviewResult,
  Segment,
  StyleRuleBody,
  TermBody,
  UploadMeta,
} from "../types";
import { BOOK, LIBRARY, buildPage } from "../fixtures/seed";

const NETWORK_DELAY = 180; // ms — a touch of latency so loading states are exercised
function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), NETWORK_DELAY));
}

// A simulated ingestion job: progresses on wall-clock time when polled.
interface Job {
  startedAt: number;
  durationMs: number;
}

// Mutable session state.
const state = {
  books: LIBRARY.map((b) => ({ ...b })),
  page: buildPage(),
  jobs: new Map<string, Job>(),
  learning: {
    tm_size: 1284,
    terms: 96,
    rules: 12,
    auto_approval_rate: 0.62,
    corrections: 341,
  } as LearningSummary,
  nextId: 6,
};

function findBook(id: string): Book | undefined {
  return state.books.find((b) => b.id === id);
}
function findSegment(id: string): Segment | undefined {
  return state.page.segments.find((s) => s.id === id);
}
const PHASES: IngestStatus["phase"][] = ["ocr", "translate", "qa"];

// Advance a running job based on elapsed time, mutating the book row.
function statusFor(book: Book): IngestStatus {
  const job = state.jobs.get(book.id);
  const total = book.page_count;
  if (!job) {
    // Not actively ingesting — derive a stable status from the book row.
    const done = Math.round(book.progress * total);
    return {
      book_id: book.id,
      status: book.status,
      phase: book.status === "published" ? "done" : "idle",
      pages_done: done,
      pages_total: total,
      has_more: book.status === "uploaded",
      progress: book.progress,
    };
  }
  const elapsed = Date.now() - job.startedAt;
  const p = Math.min(1, elapsed / job.durationMs);
  book.progress = p;
  if (p >= 1) {
    state.jobs.delete(book.id);
    book.status = "in_review";
    return {
      book_id: book.id,
      status: book.status,
      phase: "done",
      pages_done: total,
      pages_total: total,
      has_more: false,
      progress: 1,
    };
  }
  book.status = "processing";
  const phase = PHASES[Math.min(PHASES.length - 1, Math.floor(p * PHASES.length))];
  return {
    book_id: book.id,
    status: "processing",
    phase,
    pages_done: Math.round(p * total),
    pages_total: total,
    has_more: false,
    progress: p,
  };
}

export const mockApi: HaydariAPI = {
  async listBooks() {
    // Touch any running jobs so the Library reflects live progress.
    state.books.forEach((b) => statusFor(b));
    return delay(state.books.map((b) => ({ ...b })));
  },

  async getBook(id) {
    const b = findBook(id);
    if (!b) throw new Error(`Unknown book ${id}`);
    return delay({ ...b });
  },

  async deleteBook(id) {
    state.books = state.books.filter((b) => b.id !== id);
    return delay({ ok: true });
  },

  async uploadBooks(files: File[], meta?: UploadMeta) {
    const created = files.map((file, i) => {
      const id = `B-${String(state.nextId++).padStart(2, "0")}`;
      const base = file.name.replace(/\.pdf$/i, "");
      state.books.unshift({
        id,
        title_ar: meta?.title_ar || "كتاب جديد",
        title_en: (files.length === 1 && meta?.title_en) || base || `Untitled ${id}`,
        author: meta?.author || "—",
        status: "uploaded",
        page_count: 120 + Math.round(Math.random() * 300),
        progress: 0,
        translation_notes: meta?.notes || null,
      });
      return { id };
    });
    return delay(created);
  },

  async importBooks(catalog: CatalogEntry[]) {
    const created = catalog.map((c) => {
      const id = `B-${String(state.nextId++).padStart(2, "0")}`;
      state.books.push({
        id,
        title_ar: c.title_ar,
        title_en: c.title_en,
        author: c.author,
        status: "uploaded",
        page_count: 150,
        progress: 0,
      });
      return { id };
    });
    return delay(created);
  },

  async ingestBook(id, _options?: IngestOptions) {
    const b = findBook(id);
    if (!b) throw new Error(`Unknown book ${id}`);
    b.status = "processing";
    b.progress = 0;
    // Short simulated pipeline so the demo completes in a few seconds.
    state.jobs.set(id, { startedAt: Date.now(), durationMs: 9000 });
    return delay(statusFor(b));
  },

  async updateBook(id, patch) {
    const b = findBook(id);
    if (!b) throw new Error(`Unknown book ${id}`);
    if (patch.translation_notes !== undefined) b.translation_notes = patch.translation_notes;
    return delay({ ...b });
  },

  async chat(messages: ChatMessage[], _bookId?: string): Promise<ChatResult> {
    const last = messages[messages.length - 1]?.content || "";
    return delay({
      reply:
        "This is the offline demo assistant. Connect the live backend to ask real " +
        `questions about the app and manage your books. You said: “${last.slice(0, 120)}”.`,
      actions: [],
    });
  },

  async getBookStatus(id) {
    const b = findBook(id);
    if (!b) throw new Error(`Unknown book ${id}`);
    return delay(statusFor(b));
  },

  async listPages(id) {
    const b = findBook(id);
    if (!b) throw new Error(`Unknown book ${id}`);
    // The mock serves a single demo page for any reviewable book.
    return delay(b.status === "uploaded" ? [] : [1]);
  },

  async importTermbase(file: File) {
    // Estimate rows from file size; deterministic enough for the mock.
    const imported = Math.max(1, Math.round(file.size / 40)) || 24;
    state.learning.terms += imported;
    return delay({ imported });
  },

  async getPage(bookId, n) {
    if (!findBook(bookId)) throw new Error(`Unknown book ${bookId}`);
    const payload: PagePayload = {
      book: findBook(bookId)!,
      page: n,
      image_url: null,
      segments: state.page.segments.map((s) => ({ ...s })),
    };
    return delay(payload);
  },

  async getSegment(id) {
    const seg = findSegment(id);
    if (!seg) throw new Error(`Unknown segment ${id}`);
    return delay({ ...seg });
  },

  async reviewSegment(id, body: ReviewBody) {
    const seg = findSegment(id);
    if (!seg) throw new Error(`Unknown segment ${id}`);

    if (body.action === "approve") {
      seg.status = "approved";
      if (body.en_edited && body.en_edited !== seg.en) {
        seg.en_draft = seg.en_draft ?? seg.en;
        seg.en = body.en_edited;
      }
    } else if (body.action === "reject") {
      seg.status = "needs_review";
    } // skip -> unchanged

    const edited = !!body.en_edited && body.en_edited !== (seg.en_draft ?? seg.en);
    const terms = body.mqm.includes("Terminology") ? ["المتكلّمون → the mutakallimūn"] : [];

    if (body.action === "approve") {
      state.learning.corrections += 1;
      if (edited) state.learning.tm_size += 1;
    }

    const result: ReviewResult = {
      status: seg.status,
      learning: {
        tm_added: body.action === "approve",
        terms_suggested: terms,
        applied_to: terms.length ? 7 : 0,
      },
    };
    return delay(result);
  },

  async addTerm(_body: TermBody) {
    state.learning.terms += 1;
    return delay({ ok: true });
  },

  async addStyleRule(_body: StyleRuleBody) {
    state.learning.rules += 1;
    return delay({ ok: true });
  },

  async learningSummary() {
    return delay({ ...state.learning });
  },
};

// Re-exported for any component that wants the canonical demo book id.
export const DEMO_BOOK_ID = BOOK.id;
