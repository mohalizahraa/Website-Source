"use client";

import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { UploadMeta } from "@/lib/types";
import { T, useToast } from "./Toast";

export function UploadZone({ onUploaded }: { onUploaded: () => void }) {
  const { learn } = useToast();
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<UploadMeta>({});
  const [queued, setQueued] = useState<string[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const files = Array.from(fileList).filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
      if (files.length === 0) {
        learn([T.strong("Only PDFs, please."), T.text("Drop one or more .pdf files to ingest.")]);
        return;
      }
      setBusy(true);
      setQueued(files.map((f) => f.name));
      setProgress(Object.fromEntries(files.map((f) => [f.name, 0])));
      try {
        const created = await api.uploadBooks(files, meta, (file, percent) => {
          setProgress((current) => ({ ...current, [file.name]: percent }));
        });
        const duplicates = created.filter((item) => item.duplicate).length;
        const uploaded = created.length - duplicates;
        // Do NOT auto-ingest — ingestion costs tokens. The reviewer chooses a
        // page range and starts it deliberately from each book card.
        learn([
          T.strong(
            uploaded > 0
              ? `Uploaded ${uploaded} ${uploaded === 1 ? "book" : "books"}.`
              : "No duplicate books were added.",
          ),
          ...(duplicates > 0
            ? [T.text(`Skipped ${duplicates} duplicate ${duplicates === 1 ? "book" : "books"}.`)]
            : []),
          T.text(
            "Choose a page range on the book card and press Ingest to start OCR → translate → QA.",
          ),
        ]);
        setMeta({});
        onUploaded();
      } catch (e) {
        learn([T.strong("Upload failed."), T.text(String(e))]);
      } finally {
        setBusy(false);
        setTimeout(() => {
          setQueued([]);
          setProgress({});
        }, 1200);
      }
    },
    [meta, learn, onUploaded],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDrag(false);
      void handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleCsv = useCallback(
    async (fileList: FileList | null) => {
      const file = fileList?.[0];
      if (!file) return;
      try {
        const res = await api.importTermbase(file);
        learn([T.strong("Termbase imported."), T.text(`${res.imported} term pairs added to the glossary.`)]);
      } catch (e) {
        learn([T.strong("Import failed."), T.text(String(e))]);
      }
    },
    [learn],
  );

  return (
    <div className="uploader">
      <div
        className={"dropzone" + (drag ? " drag" : "")}
        role="button"
        tabIndex={0}
        aria-label="Upload PDFs: drag and drop, or activate to browse"
        onClick={() => fileInput.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInput.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        <svg className="di" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M12 16V4M12 4L7 9M12 4l5 5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" strokeLinecap="round" />
        </svg>
        <b>{busy ? "Uploading…" : "Drop PDFs here"}</b>
        <span className="hint">Drag &amp; drop, or click to browse — single or bulk</span>
        <span className="sub">Scanned Arabic manuscripts · one book per PDF</span>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => void handleFiles(e.target.files)}
        />

        {queued.length > 0 && (
          <div className="queued" onClick={(e) => e.stopPropagation()}>
            {queued.map((n) => (
              <div className="queued-item" key={n}>
                <span className="qi-name">{n}</span>
                <span className="qi-bar">
                  <i style={{ width: `${progress[n] ?? (busy ? 0 : 100)}%` }} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="meta-card">
        <div className="mc-title">Optional metadata</div>
        <div className="field">
          <label htmlFor="m-ar">Arabic title</label>
          <input
            id="m-ar"
            dir="rtl"
            lang="ar"
            placeholder="عنوان الكتاب"
            value={meta.title_ar || ""}
            onChange={(e) => setMeta((m) => ({ ...m, title_ar: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="m-en">English title</label>
          <input
            id="m-en"
            placeholder="English title"
            value={meta.title_en || ""}
            onChange={(e) => setMeta((m) => ({ ...m, title_en: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="m-au">Author</label>
          <input
            id="m-au"
            placeholder="Author"
            value={meta.author || ""}
            onChange={(e) => setMeta((m) => ({ ...m, author: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="m-notes">Translation instructions</label>
          <textarea
            id="m-notes"
            rows={3}
            placeholder="e.g. Transliterate all divine names; keep footnotes as footnotes; prefer &lsquo;the mutakallimūn&rsquo; for المتكلّمون."
            value={meta.notes || ""}
            onChange={(e) => setMeta((m) => ({ ...m, notes: e.target.value }))}
          />
          <span className="bc-meta">
            Injected into every translation for this book. You can also change this later via the
            assistant.
          </span>
        </div>

        <div className="mc-title" style={{ marginTop: 14 }}>
          Glossary / termbase
        </div>
        <div className="csv-row">
          <button className="btn sm" type="button" onClick={() => csvInput.current?.click()}>
            Import termbase CSV
          </button>
          <span className="bc-meta">term_ar, term_en, note</span>
          <input
            ref={csvInput}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => void handleCsv(e.target.files)}
          />
        </div>
      </div>
    </div>
  );
}
