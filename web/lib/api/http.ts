// HTTP adapter — talks to the real FastAPI backend at NEXT_PUBLIC_API_BASE.
// Endpoints match ARCHITECTURE.md §"HTTP API" exactly.

import type {
  AdminSettings,
  AdminUser,
  Book,
  CatalogEntry,
  ChatMessage,
  ChatResult,
  HaydariAPI,
  SettingsPatch,
  UsageMe,
  UsageOverview,
  IngestOptions,
  IngestStatus,
  LearningSummary,
  PagePayload,
  ReviewBody,
  ReviewResult,
  Segment,
  NewUser,
  StyleRuleBody,
  TermBody,
  UploadMeta,
  User,
} from "../types";

const BASE = process.env.NEXT_PUBLIC_API_BASE || "/api";

// Carries the HTTP status so callers (auth guard, UI) can special-case 401/403.
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// `credentials: "include"` is REQUIRED: the session lives in an httponly cookie
// and the frontend is a different origin (localhost:3000 → :8000), so the
// browser only sends the cookie when we opt in. The backend sets
// allow_credentials=True with explicit origins (never "*") to match.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, `${init?.method || "GET"} ${path} -> ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

// Multipart POST — no JSON Content-Type header (the browser sets the boundary).
async function upload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, `POST ${path} -> ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

// The backend sends `progress` as an object ({fraction, approved, …}) on Book
// and may send it as a number on IngestStatus. Normalize to the wire types the
// UI expects (progress: number, page_count: number, book on the page payload).
function frac(p: unknown): number {
  if (typeof p === "number") return p;
  if (p && typeof (p as { fraction?: unknown }).fraction === "number") {
    return (p as { fraction: number }).fraction;
  }
  return 0;
}

function mapBook(raw: any): Book {
  return {
    id: raw.id,
    title_ar: raw.title_ar ?? "",
    title_en: raw.title_en ?? "",
    author: raw.author ?? "",
    status: raw.status,
    // Prefer the true PDF page total; fall back to any legacy page_count.
    page_count:
      typeof raw.pages_total === "number" && raw.pages_total > 0
        ? raw.pages_total
        : typeof raw.page_count === "number"
          ? raw.page_count
          : 1,
    progress: frac(raw.progress),
    pages_total: typeof raw.pages_total === "number" ? raw.pages_total : 0,
    translation_notes: raw.translation_notes ?? null,
  };
}

function mapIngest(raw: any): IngestStatus {
  return {
    book_id: raw.book_id,
    status: raw.status,
    phase: raw.phase ?? "idle",
    pages_done: raw.pages_done ?? 0,
    pages_total: raw.pages_total ?? 0,
    has_more: !!raw.has_more,
    progress: frac(raw.progress),
    detail: raw.detail && Object.keys(raw.detail).length ? raw.detail : undefined,
  };
}

export const httpApi: HaydariAPI = {
  // --- auth ---
  me() {
    // 401 here just means "not logged in" — resolve to null instead of throwing.
    return request<User | null>("/auth/me").catch((e) => {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    });
  },
  login(email, password) {
    return request<User>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },
  logout() {
    return request<{ ok: boolean }>("/auth/logout", { method: "POST" });
  },
  createUser(body: NewUser) {
    return request<User>("/auth/users", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  usageMe() {
    return request<UsageMe>("/usage/me");
  },
  usageOverview() {
    return request<UsageOverview>("/usage");
  },
  getSettings() {
    return request<AdminSettings>("/settings");
  },
  updateSettings(patch: SettingsPatch) {
    return request<AdminSettings>("/settings", { method: "PUT", body: JSON.stringify(patch) });
  },
  listUsers() {
    return request<AdminUser[]>("/auth/users");
  },
  updateUser(id, patch) {
    return request<AdminUser>(`/auth/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  async listBooks() {
    return (await request<any[]>("/books")).map(mapBook);
  },
  async getBook(id) {
    return mapBook(await request<any>(`/books/${encodeURIComponent(id)}`));
  },
  deleteBook(id) {
    return request<{ ok: boolean }>(`/books/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async updateBook(id, patch) {
    return mapBook(
      await request<any>(`/books/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    );
  },
  uploadBooks(files: File[], meta?: UploadMeta) {
    const form = new FormData();
    files.forEach((f) => form.append("files", f, f.name));
    if (meta?.title_ar) form.append("title_ar", meta.title_ar);
    if (meta?.title_en) form.append("title_en", meta.title_en);
    if (meta?.author) form.append("author", meta.author);
    if (meta?.notes) form.append("notes", meta.notes);
    return upload<{ id: string }[]>("/books/upload", form);
  },
  importBooks(catalog: CatalogEntry[]) {
    return request<{ id: string }[]>("/books/import", {
      method: "POST",
      body: JSON.stringify(catalog),
    });
  },
  async ingestBook(id, options?: IngestOptions) {
    await request<any>(`/books/${encodeURIComponent(id)}/ingest`, {
      method: "POST",
      body: JSON.stringify(options ?? {}),
    });
    // The ingest response is the enqueue ack; return the live status snapshot.
    return mapIngest(await request<any>(`/books/${encodeURIComponent(id)}/status`));
  },
  async getBookStatus(id) {
    return mapIngest(await request<any>(`/books/${encodeURIComponent(id)}/status`));
  },
  async listPages(id) {
    const r = await request<{ pages: number[] }>(`/books/${encodeURIComponent(id)}/pages`);
    return r.pages ?? [];
  },
  chat(messages: ChatMessage[], bookId?: string) {
    return request<ChatResult>("/chat", {
      method: "POST",
      body: JSON.stringify({ messages, book_id: bookId }),
    });
  },
  importTermbase(file: File) {
    const form = new FormData();
    form.append("file", file, file.name);
    return upload<{ imported: number }>("/termbase/import", form);
  },
  async getPage(bookId, n) {
    // Backend page payload is { page, image_url, segments } — it does NOT include
    // the book. Fetch the book alongside so the workbench has book metadata.
    const [raw, book] = await Promise.all([
      request<any>(`/books/${encodeURIComponent(bookId)}/pages/${n}`),
      request<any>(`/books/${encodeURIComponent(bookId)}`),
    ]);
    return {
      book: mapBook(book),
      page: raw.page,
      image_url: raw.image_url ?? null,
      segments: (raw.segments ?? []) as Segment[],
    };
  },
  getSegment(id) {
    return request<Segment>(`/segments/${encodeURIComponent(id)}`);
  },
  reviewSegment(id, body: ReviewBody) {
    return request<ReviewResult>(`/segments/${encodeURIComponent(id)}/review`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  addTerm(body: TermBody) {
    return request<{ ok: boolean }>("/termbase", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  addStyleRule(body: StyleRuleBody) {
    return request<{ ok: boolean }>("/style-rules", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  learningSummary() {
    return request<LearningSummary>("/learning/summary");
  },
};
