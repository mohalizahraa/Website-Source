"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, DATA_SOURCE } from "@/lib/api";
import type { Book } from "@/lib/types";
import { BrandMark } from "./BrandMark";
import { UploadZone } from "./UploadZone";
import { T, useToast } from "./Toast";

const STATUS_LABEL: Record<Book["status"], string> = {
  uploaded: "Uploaded",
  processing: "Processing",
  in_review: "In review",
  published: "Published",
};

function BookCard({ book, onIngest }: { book: Book; onIngest: (id: string) => void }) {
  const pctText = Math.round(book.progress * 100) + "%";
  const openable = book.status === "in_review" || book.status === "published";
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
        {book.page_count} pages ·{" "}
        {book.status === "processing"
          ? "ingesting…"
          : book.status === "uploaded"
            ? "awaiting ingestion"
            : `${Math.round(book.progress * book.page_count)} approved`}
      </div>

      <div className="bc-actions">
        {book.status === "uploaded" && (
          <button className="btn btn-primary sm" onClick={() => onIngest(book.id)}>
            Ingest
          </button>
        )}
        {book.status === "processing" && (
          <button className="btn sm" disabled>
            Ingesting…
          </button>
        )}
        {openable && (
          <Link className="btn btn-primary sm" href={`/review/${encodeURIComponent(book.id)}`}>
            Open review
          </Link>
        )}
      </div>
    </div>
  );
}

export function Library() {
  const { learn } = useToast();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const booksRef = useRef<Book[]>([]);
  booksRef.current = books;

  const refresh = useCallback(async () => {
    const list = await api.listBooks();
    setBooks(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Single interval: poll status for any book currently processing.
  useEffect(() => {
    const id = setInterval(async () => {
      const processing = booksRef.current.filter((b) => b.status === "processing");
      if (processing.length === 0) return;
      const results = await Promise.all(
        processing.map((b) => api.getBookStatus(b.id).catch(() => null)),
      );
      setBooks((prev) =>
        prev.map((b) => {
          const r = results.find((x) => x && x.book_id === b.id);
          return r ? { ...b, status: r.status, progress: r.progress } : b;
        }),
      );
    }, 1200);
    return () => clearInterval(id);
  }, []);

  const ingest = useCallback(
    async (id: string) => {
      const s = await api.ingestBook(id);
      setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, status: s.status, progress: s.progress } : b)));
      learn([T.strong("Ingestion started."), T.text("OCR → translate → QA pipeline is running.")]);
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
        <div className="who">
          <span className="avatar" title="Reviewer">
            HA
          </span>
        </div>
      </header>

      <main className="home-main">
        <div className="home-inner">
          <div className="home-head">
            <div>
              <h1>Library</h1>
              <p className="lede">
                Upload Arabic source PDFs, run the OCR → translate → QA pipeline, then open a book to
                review its translation. Every edit becomes training signal.
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

          <div className="section-label">Add books</div>
          <UploadZone onUploaded={refresh} />

          <div className="section-label">Your books</div>
          {loading ? (
            <div style={{ color: "var(--ink-3)", fontSize: "var(--fs-sm)" }}>Loading library…</div>
          ) : books.length === 0 ? (
            <div style={{ color: "var(--ink-3)", fontSize: "var(--fs-sm)" }}>
              No books yet — upload a PDF to begin.
            </div>
          ) : (
            <div className="book-grid">
              {books.map((b) => (
                <BookCard key={b.id} book={b} onIngest={ingest} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
