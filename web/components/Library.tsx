"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, DATA_SOURCE } from "@/lib/api";
import type { Book, IngestOptions, IngestStatus } from "@/lib/types";
import { BrandMark } from "./BrandMark";
import { UploadZone } from "./UploadZone";
import { ChatWidget } from "./ChatWidget";
import { AuthMenu } from "./AuthMenu";
import { T, useToast } from "./Toast";
import { canWrite, useAuth } from "@/lib/auth";

const STATUS_LABEL: Record<Book["status"], string> = {
  uploaded: "Uploaded",
  processing: "Processing",
  in_review: "In review",
  published: "Published",
};

// Compact page-range + cap form shown on a book that can be (further) ingested.
function IngestControls({
  status,
  onStart,
  busy,
}: {
  status?: IngestStatus;
  onStart: (opts: IngestOptions) => void;
  busy: boolean;
}) {
  const done = status?.pages_done ?? 0;
  const total = status?.pages_total ?? 0;
  const isContinue = done > 0;
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [cap, setCap] = useState<string>("20");
  const [force, setForce] = useState<boolean>(false);

  const start = () => {
    const opts: IngestOptions = {};
    const f = parseInt(from, 10);
    const t = parseInt(to, 10);
    const c = parseInt(cap, 10);
    if (!Number.isNaN(f)) opts.from_page = f;
    else if (isContinue && !force) opts.from_page = done + 1; // resume from next page
    if (!Number.isNaN(t)) opts.to_page = t;
    if (!Number.isNaN(c)) opts.max_pages = c;
    if (force) opts.force = true;
    onStart(opts);
  };

  return (
    <div className="ingest-ctl">
      <div className="ic-fields">
        <label>
          From
          <input
            type="number"
            min={1}
            placeholder={isContinue ? String(done + 1) : "1"}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="number"
            min={1}
            placeholder={total ? String(total) : "end"}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label>
          Max/run
          <input type="number" min={1} value={cap} onChange={(e) => setCap(e.target.value)} />
        </label>
      </div>
      <div className="ic-side">
        {isContinue && (
          <label className="ic-force" title="Re-run pages that are already finished (to apply pipeline improvements). Overwrites their current translations.">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            Redo finished pages
          </label>
        )}
        <button className="btn btn-primary sm" onClick={start} disabled={busy}>
          {busy ? "Working…" : force ? "Reprocess" : isContinue ? "Continue" : "Ingest"}
        </button>
      </div>
    </div>
  );
}

function BookCard({
  book,
  status,
  onIngest,
  onDelete,
  busy,
  canManage,
}: {
  book: Book;
  status?: IngestStatus;
  onIngest: (id: string, opts: IngestOptions) => void;
  onDelete: (id: string) => void;
  busy: boolean;
  canManage: boolean; // false for anonymous / reader visitors (published-only view)
}) {
  const total = status?.pages_total ?? book.pages_total ?? 0;
  const done = status?.pages_done ?? 0;
  const processing = book.status === "processing" || status?.status === "processing";
  const hasMore = !!status?.has_more;
  // Progress bar tracks INGEST completion (pages done / total) so it moves live.
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : processing ? 5 : 0;
  const pctText = pct + "%";
  // Reviewable whenever at least one page is done — including WHILE it ingests,
  // since pages are committed one at a time and reviewing them is non-blocking.
  const openable = book.status === "in_review" || book.status === "published" || done > 0;
  const canIngest = canManage && !processing && (book.status === "uploaded" || hasMore);

  return (
    <div className="book-card">
      <div className="bc-top">
        <div className="bc-titles">
          <div className="bc-ar" dir="rtl" lang="ar">
            {book.title_ar}
          </div>
          <div className="bc-en">{book.title_en}</div>
          <div className="bc-author">{book.author}</div>
        </div>
        <span className={"pill " + book.status}>{STATUS_LABEL[book.status]}</span>
      </div>

      <div className="bc-prog">
        <span className={"bc-bar" + (book.status === "published" ? " published" : "")}>
          <i style={{ width: pctText }} />
        </span>
        <span className="bc-pct">{pctText}</span>
      </div>
      <div className="bc-meta">
        {total ? `${done} / ${total} pages ingested` : `${done} pages ingested`}
        {!processing && hasMore ? ` · ${total - done} remaining` : ""}
      </div>
      {processing && status?.detail?.message && (
        <div className="bc-live">
          <span className="lb-dot" /> {status.detail.message}
        </div>
      )}
      {!processing && status?.detail?.failed && status.detail.failed.length > 0 && (
        <div className="bc-fail">
          ⚠ {status.detail.failed.length} page(s) failed last run (
          {status.detail.failed.slice(0, 6).join(", ")}
          {status.detail.failed.length > 6 ? "…" : ""}) — check “Redo finished pages” and Reprocess.
        </div>
      )}
      {book.translation_notes ? (
        <div className="bc-notes" title={book.translation_notes}>
          <b>Instructions:</b> {book.translation_notes}
        </div>
      ) : null}

      {canIngest && <IngestControls status={status} busy={busy} onStart={(o) => onIngest(book.id, o)} />}

      <div className="bc-actions">
        {processing && (
          <button className="btn sm" disabled>
            Ingesting…
          </button>
        )}
        {openable && (
          <Link className="btn btn-primary sm" href={`/review/${encodeURIComponent(book.id)}`}>
            {processing ? "Review (live)" : canManage ? "Open review" : "Read"}
          </Link>
        )}
        <span className="spacer" />
        {canManage && (
          <button
            className="btn btn-danger sm"
            onClick={() => onDelete(book.id)}
            aria-label={`Delete ${book.title_en || book.title_ar || book.id}`}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

export function Library() {
  const { learn } = useToast();
  const { user, loading: authLoading } = useAuth();
  const loggedIn = !!user;
  const manage = canWrite(user); // creators/admins manage books; anon/readers browse
  const [books, setBooks] = useState<Book[]>([]);
  const [statuses, setStatuses] = useState<Record<string, IngestStatus>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const booksRef = useRef<Book[]>([]);
  booksRef.current = books;
  // Guards against a stale listBooks() (e.g. the creator-scoped fetch in flight
  // when you log out) resolving after a newer one and repopulating private books.
  const loadSeq = useRef(0);

  const loadStatus = useCallback(async (id: string) => {
    const s = await api.getBookStatus(id).catch(() => null);
    if (s) setStatuses((prev) => ({ ...prev, [id]: s }));
    return s;
  }, []);

  const refresh = useCallback(async () => {
    const mine = ++loadSeq.current;
    const list = await api.listBooks();
    if (mine !== loadSeq.current) return; // superseded by a newer refresh
    setBooks(list);
    setLoading(false);
    // Pull live ingest status for every book so bars reflect real progress.
    await Promise.all(list.map((b) => loadStatus(b.id)));
  }, [loadStatus]);

  // (Re)load the library once the auth state is known, and again whenever the
  // signed-in identity changes — the backend returns published-only for anon
  // vs. your own books when logged in.
  useEffect(() => {
    if (authLoading) return;
    setLoading(true);
    void refresh();
  }, [refresh, authLoading, user?.id]);

  // Poll status for any book that is actively processing.
  useEffect(() => {
    const id = setInterval(async () => {
      const active = booksRef.current.filter(
        (b) => b.status === "processing" || statuses[b.id]?.status === "processing",
      );
      if (active.length === 0) return;
      const results = await Promise.all(active.map((b) => api.getBookStatus(b.id).catch(() => null)));
      setStatuses((prev) => {
        const next = { ...prev };
        results.forEach((r) => {
          if (r) next[r.book_id] = r;
        });
        return next;
      });
      setBooks((prev) =>
        prev.map((b) => {
          const r = results.find((x) => x && x.book_id === b.id);
          return r ? { ...b, status: r.status } : b;
        }),
      );
    }, 1500);
    return () => clearInterval(id);
  }, [statuses]);

  const ingest = useCallback(
    async (id: string, opts: IngestOptions) => {
      setBusy((p) => ({ ...p, [id]: true }));
      try {
        const s = await api.ingestBook(id, opts);
        setStatuses((prev) => ({ ...prev, [id]: s }));
        setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, status: s.status } : b)));
        learn([
          T.strong("Ingestion started."),
          T.text(
            `Processing ${opts.from_page ? `from page ${opts.from_page}` : "the next pages"}` +
              `${opts.max_pages ? ` (up to ${opts.max_pages} this run)` : ""}. Progress updates live.`,
          ),
        ]);
      } catch (e) {
        learn([T.strong("Couldn't start ingestion."), T.text(String(e))]);
      } finally {
        setBusy((p) => ({ ...p, [id]: false }));
      }
    },
    [learn],
  );

  const remove = useCallback(
    async (id: string) => {
      const b = booksRef.current.find((x) => x.id === id);
      const name = b?.title_en || b?.title_ar || id;
      if (
        !window.confirm(
          `Delete "${name}" and all its pages, segments, and translations? This can't be undone.`,
        )
      ) {
        return;
      }
      try {
        await api.deleteBook(id);
        setBooks((prev) => prev.filter((x) => x.id !== id));
        learn([T.strong("Deleted."), T.text(`"${name}" and its data were removed.`)]);
      } catch (e) {
        learn([T.strong("Couldn't delete."), T.text(String(e))]);
      }
    },
    [learn],
  );

  const stats = {
    total: books.length,
    inReview: books.filter((b) => b.status === "in_review").length,
    published: books.filter((b) => b.status === "published").length,
  };

  return (
    <div className="app">
      <header className="bar">
        <div className="brand">
          <BrandMark />
          <b>Miʿrāj</b>
        </div>
        <div className="book">
          <span className="en">Translation Library</span>
        </div>
        <div className="spacer" />
        <span className="datasrc" title="Active data adapter">
          {DATA_SOURCE === "mock" ? "mock data" : "live api"}
        </span>
        <AuthMenu />
      </header>

      <main className="home-main">
        <div className="home-inner">
          <div className="home-head">
            <div>
              <h1>{loggedIn ? "Library" : "Published Library"}</h1>
              <p className="lede">
                {manage
                  ? "Upload Arabic source PDFs, choose a page range, and run the OCR → translate → QA pipeline. Progress is live and resumable. Every edit becomes training signal."
                  : loggedIn
                    ? "You have read-only access. Browse the translations available to your account below."
                    : "Read published English translations of the Haydari corpus. Sign in to upload sources and join the translation workbench."}
              </p>
            </div>
            <div className="home-stats">
              <div className="home-stat">
                <b>{stats.total}</b>
                <span>Books</span>
              </div>
              <div className="home-stat">
                <b>{stats.inReview}</b>
                <span>In review</span>
              </div>
              <div className="home-stat">
                <b>{stats.published}</b>
                <span>Published</span>
              </div>
            </div>
          </div>

          {manage && (
            <>
              <div className="section-label">Add books</div>
              <UploadZone onUploaded={refresh} />
            </>
          )}

          <div className="section-label">
            {manage ? "Your books" : loggedIn ? "Books" : "Published translations"}
          </div>
          {loading ? (
            <div style={{ color: "var(--ink-3)", fontSize: "var(--fs-sm)" }}>Loading library…</div>
          ) : books.length === 0 ? (
            <div style={{ color: "var(--ink-3)", fontSize: "var(--fs-sm)" }}>
              {manage
                ? "No books yet — upload a PDF to begin."
                : "No published translations yet — check back soon."}
            </div>
          ) : (
            <div className="book-grid">
              {books.map((b) => (
                <BookCard
                  key={b.id}
                  book={b}
                  status={statuses[b.id]}
                  busy={!!busy[b.id]}
                  onIngest={ingest}
                  onDelete={remove}
                  canManage={manage}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* The chat assistant calls authenticated, per-book tools — creators only. */}
      {manage && <ChatWidget />}
    </div>
  );
}
