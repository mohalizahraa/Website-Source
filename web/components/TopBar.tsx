"use client";

import { BrandMark } from "./BrandMark";
import type { Book } from "@/lib/types";

export type SaveState = "saved" | "unsaved" | "saving";

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Saved",
  unsaved: "Unsaved edits",
  saving: "Saving…",
};

export function TopBar({
  book,
  page,
  pageCount,
  onPrev,
  onNext,
  onBack,
  hasPrev,
  hasNext,
  saveState,
  reviewer = "HA",
  readOnly = false,
}: {
  book: Book;
  page: number;
  pageCount: number;
  onPrev: () => void;
  onNext: () => void;
  onBack?: () => void | Promise<void>;
  hasPrev?: boolean; // overrides default page<=1 (for non-contiguous page sets)
  hasNext?: boolean; // overrides default page>=pageCount
  saveState: SaveState;
  reviewer?: string;
  readOnly?: boolean; // hide write affordances (kbd hints, save state) for readers
}) {
  return (
    <header className="bar">
      <button type="button" className="brand" aria-label="Back to library" onClick={() => void onBack?.()}>
        <BrandMark />
        <b>Miʿrāj</b>
      </button>
      <div className="book">
        <span className="ar" dir="rtl">
          {book.title_ar}
        </span>
        <span className="en">
          {book.title_en} · {book.author}
        </span>
      </div>
      <div className="pager">
        <button
          aria-label="Previous page"
          onClick={onPrev}
          disabled={hasPrev === undefined ? page <= 1 : !hasPrev}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M10 3L5 8l5 5" />
          </svg>
        </button>
        <span className="pg">
          Page <b>{page}</b> / {pageCount}
        </span>
        <button
          aria-label="Next page"
          onClick={onNext}
          disabled={hasNext === undefined ? page >= pageCount : !hasNext}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M6 3l5 5-5 5" />
          </svg>
        </button>
      </div>
      <div className="spacer" />
      {readOnly ? (
        <div className="kbd-hint">
          <kbd>J</kbd>
          <kbd>K</kbd> move
        </div>
      ) : (
        <>
          <div className="kbd-hint">
            <kbd>J</kbd>
            <kbd>K</kbd> move&nbsp;·&nbsp;<kbd>A</kbd> accept&nbsp;·&nbsp;<kbd>⌘S</kbd> save
          </div>
          <div className={"save " + saveState} aria-live="polite">
            <span className="dot" /> {SAVE_LABEL[saveState]}
          </div>
        </>
      )}
      <div className="who">
        <span className="avatar" title="Reviewer">
          {reviewer}
        </span>
      </div>
    </header>
  );
}
