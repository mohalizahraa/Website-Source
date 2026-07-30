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
  User,
} from "../types";
import { BOOK, LIBRARY, buildPage } from "../fixtures/seed";
import { ApiError } from "./http";

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

// A tiny fixed user table so mock mode can reproduce the real auth states:
// invalid credentials (401), and admin/creator/reader role sessions. Mock mode
// starts signed-in as the admin so the full workbench is reachable with no
// backend; logout() clears the session to exercise the logged-out UI.
type MockUser = User & { password: string; monthly_usd_limit?: number | null };
const MOCK_USERS: MockUser[] = [
  { id: "U-01", email: "admin@haydari.local", display_name: "Haydari Admin", role: "admin", password: "changeme-admin" },
  { id: "U-02", email: "creator@haydari.local", display_name: "Creator", role: "creator", password: "password123" },
  { id: "U-03", email: "reader@haydari.local", display_name: "Reader", role: "reader", password: "password123" },
];
function publicUser(u: MockUser): User {
  const { password: _pw, monthly_usd_limit: _l, ...rest } = u;
  return rest;
}
let mockSession: User | null = publicUser(MOCK_USERS[0]);

// Admin-editable runtime config (mock mirror of the settings table).
const MOCK_SETTINGS_DEFAULTS = { global_monthly_usd: 50, user_monthly_usd_default: 5, max_pages_per_run: 20 };
const mockSettings = { ...MOCK_SETTINGS_DEFAULTS } as {
  global_monthly_usd: number | null;
  user_monthly_usd_default: number | null;
  max_pages_per_run: number;
};
function guardAdmin(): void {
  if (!mockSession) throw new ApiError(401, "authentication required");
  if (mockSession.role !== "admin") throw new ApiError(403, "admin only");
}

// Every mutating method calls this so mock mode mirrors the backend: not
// signed in -> 401 (mutations stop after logout()), and reader-role -> 403
// (every mock mutation maps to a create/write the backend forbids readers).
function guardSession(): void {
  if (!mockSession) throw new ApiError(401, "authentication required");
  if (mockSession.role === "reader") throw new ApiError(403, "read-only account");
}

export const mockApi: HaydariAPI = {
  // --- auth ---
  me() {
    return delay(mockSession);
  },
  login(email, password) {
    // Validate against the fixed table so invalid creds fail like /auth/login.
    const u = MOCK_USERS.find((m) => m.email === email && m.password === password);
    if (!u) throw new ApiError(401, "invalid email or password");
    mockSession = publicUser(u);
    return delay(mockSession);
  },
  logout() {
    mockSession = null;
    return delay({ ok: true });
  },
  changePassword(currentPassword, newPassword) {
    if (!mockSession) throw new ApiError(401, "authentication required");
    const user = MOCK_USERS.find((candidate) => candidate.id === mockSession?.id);
    if (!user || user.password !== currentPassword || newPassword.length < 8) {
      throw new ApiError(400, "password change rejected");
    }
    user.password = newPassword;
    return delay({ ok: true });
  },
  createUser(body) {
    // Match the real endpoint's dependency chain: require_user (401) then
    // require_admin (403).
    if (!mockSession) throw new ApiError(401, "authentication required");
    if (mockSession.role !== "admin") throw new ApiError(403, "admin only");
    const created: User & { password: string; monthly_usd_limit?: number | null } = {
      id: "U-" + body.email.slice(0, 4),
      email: body.email,
      display_name: body.display_name ?? null,
      role: body.role ?? "creator",
      password: body.password,
      monthly_usd_limit: body.monthly_usd_limit ?? null,
    };
    MOCK_USERS.push(created); // so the new account can actually log in
    return delay<User>(publicUser(created));
  },

  usageMe() {
    if (!mockSession) throw new ApiError(401, "authentication required");
    const isAdmin = mockSession.role === "admin";
    const cap = isAdmin ? null : mockSettings.user_monthly_usd_default;
    const spent = 0.42;
    return delay({
      month: "2026-07",
      spent_usd: spent,
      limit_usd: cap,
      remaining_usd: cap == null ? null : Math.max(0, cap - spent),
      enforced: !isAdmin,
    });
  },
  usageOverview() {
    guardAdmin();
    return delay({
      month: "2026-07",
      global_spent_usd: 4.2,
      global_limit_usd: mockSettings.global_monthly_usd,
      global_remaining_usd:
        mockSettings.global_monthly_usd == null ? null : Math.max(0, mockSettings.global_monthly_usd - 4.2),
      user_limit_default_usd: mockSettings.user_monthly_usd_default,
      by_user: MOCK_USERS.map((u, i) => ({ user_id: u.id, cost_usd: [4.2, 0, 0][i] ?? 0, tokens: 12000, calls: 3 })),
    });
  },
  getSettings() {
    guardAdmin();
    return delay({ ...mockSettings, defaults: { ...MOCK_SETTINGS_DEFAULTS } });
  },
  updateSettings(patch) {
    guardAdmin();
    // "off" = no cap (null); null = clear override → env default; number = set.
    const cap = (v: number | null | "off" | undefined, dflt: number | null) =>
      v === undefined ? undefined : v === "off" ? null : v === null ? dflt : v;
    const g = cap(patch.global_monthly_usd, MOCK_SETTINGS_DEFAULTS.global_monthly_usd);
    const d = cap(patch.user_monthly_usd_default, MOCK_SETTINGS_DEFAULTS.user_monthly_usd_default);
    if (g !== undefined) mockSettings.global_monthly_usd = g;
    if (d !== undefined) mockSettings.user_monthly_usd_default = d;
    if (patch.max_pages_per_run != null) mockSettings.max_pages_per_run = patch.max_pages_per_run;
    return delay({ ...mockSettings, defaults: { ...MOCK_SETTINGS_DEFAULTS } });
  },
  listUsers() {
    guardAdmin();
    return delay(
      MOCK_USERS.map((u) => ({
        ...publicUser(u),
        monthly_usd_limit: u.monthly_usd_limit ?? null,
        spent_usd: u.role === "admin" ? 4.2 : 0,
      })),
    );
  },
  updateUser(id, patch) {
    guardAdmin();
    const u = MOCK_USERS.find((m) => m.id === id);
    if (!u) throw new ApiError(404, "user not found");
    if (patch.monthly_usd_limit !== undefined) u.monthly_usd_limit = patch.monthly_usd_limit;
    if (patch.role) u.role = patch.role;
    return delay({ ...publicUser(u), monthly_usd_limit: u.monthly_usd_limit ?? null, spent_usd: 0 });
  },

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
    guardSession();
    state.books = state.books.filter((b) => b.id !== id);
    return delay({ ok: true });
  },

  async uploadBooks(files: File[], meta?: UploadMeta, onProgress?: (file: File, percent: number) => void) {
    guardSession();
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
      onProgress?.(file, 100);
      return { id, duplicate: false };
    });
    return delay(created);
  },

  async importBooks(catalog: CatalogEntry[]) {
    guardSession();
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
    guardSession();
    const b = findBook(id);
    if (!b) throw new Error(`Unknown book ${id}`);
    b.status = "processing";
    b.progress = 0;
    // Short simulated pipeline so the demo completes in a few seconds.
    state.jobs.set(id, { startedAt: Date.now(), durationMs: 9000 });
    return delay(statusFor(b));
  },

  async updateBook(id, patch) {
    guardSession();
    const b = findBook(id);
    if (!b) throw new Error(`Unknown book ${id}`);
    if (patch.translation_notes !== undefined) b.translation_notes = patch.translation_notes;
    return delay({ ...b });
  },

  async chat(messages: ChatMessage[], _bookId?: string): Promise<ChatResult> {
    guardSession();
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
    guardSession();
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

  async saveSegmentDraft(id, enEdited) {
    guardSession();
    const seg = findSegment(id);
    if (!seg) throw new Error(`Unknown segment ${id}`);
    seg.en_draft = seg.en_draft ?? seg.en;
    seg.en = enEdited;
    seg.status = "draft";
    return delay({ ...seg });
  },

  async reviewSegment(id, body: ReviewBody) {
    guardSession();
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
    } else {
      // Skip preserves the editor's current text without changing status.
      seg.en_draft = seg.en_draft ?? seg.en;
      seg.en = body.en_edited;
    }

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

  async reviewWithLLM(id, enEdited) {
    guardSession();
    const seg = findSegment(id);
    if (!seg) throw new Error(`Unknown segment ${id}`);
    return delay({
      model: "mock-frontier-reviewer",
      assessment: "The rendering is faithful overall; verify the technical terminology.",
      suggestion: enEdited,
      issues: [],
    });
  },

  async addTerm(_body: TermBody) {
    guardSession();
    state.learning.terms += 1;
    return delay({ ok: true });
  },

  async addStyleRule(_body: StyleRuleBody) {
    guardSession();
    state.learning.rules += 1;
    return delay({ ok: true });
  },

  async learningSummary() {
    return delay({ ...state.learning });
  },
};

// Re-exported for any component that wants the canonical demo book id.
export const DEMO_BOOK_ID = BOOK.id;
