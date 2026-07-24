// HTTP adapter — talks to the real FastAPI backend at NEXT_PUBLIC_API_BASE.
// Endpoints match ARCHITECTURE.md §"HTTP API" exactly.

import type {
  Book,
  CatalogEntry,
  HaydariAPI,
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

const BASE = process.env.NEXT_PUBLIC_API_BASE || "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${init?.method || "GET"} ${path} -> ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

// Multipart POST — no JSON Content-Type header (the browser sets the boundary).
async function upload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${path} -> ${res.status} ${text}`);
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
    page_count: typeof raw.page_count === "number" ? raw.page_count : 1,
    progress: frac(raw.progress),
  };
}

function mapIngest(raw: any): IngestStatus {
  return {
    book_id: raw.book_id,
    status: raw.status,
    phase: raw.phase ?? "idle",
    pages_done: raw.pages_done ?? 0,
    pages_total: raw.pages_total ?? 0,
    progress: frac(raw.progress),
  };
}

export const httpApi: HaydariAPI = {
  async listBooks() {
    return (await request<any[]>("/books")).map(mapBook);
  },
  async getBook(id) {
    return mapBook(await request<any>(`/books/${encodeURIComponent(id)}`));
  },
  uploadBooks(files: File[], meta?: UploadMeta) {
    const form = new FormData();
    files.forEach((f) => form.append("files", f, f.name));
    if (meta?.title_ar) form.append("title_ar", meta.title_ar);
    if (meta?.title_en) form.append("title_en", meta.title_en);
    if (meta?.author) form.append("author", meta.author);
    return upload<{ id: string }[]>("/books/upload", form);
  },
  importBooks(catalog: CatalogEntry[]) {
    return request<{ id: string }[]>("/books/import", {
      method: "POST",
      body: JSON.stringify(catalog),
    });
  },
  async ingestBook(id) {
    return mapIngest(
      await request<any>(`/books/${encodeURIComponent(id)}/ingest`, { method: "POST" }),
    );
  },
  async getBookStatus(id) {
    return mapIngest(await request<any>(`/books/${encodeURIComponent(id)}/status`));
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
