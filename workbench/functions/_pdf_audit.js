// Verified by a full 176-book byte-level audit on the founder's self-hosted Mac runner.
// Evidence: userpkm Actions run 37112926137, job 111174193227, completed 2026-10-03T09:24:34Z.
// The four missing records are the only books that did not yield a verified direct PDF.
// Candidate URLs remain owned by _catalog.js / _pdf_candidates.js so this audit does not duplicate the URL corpus.

import { BOOK_CATALOG } from './_catalog.js';
import { PDF_CANDIDATE_OVERRIDES } from './_pdf_candidates.js';

export const PDF_AUDIT_VERSION = "audit-2026-10-03T09:24:31.074Z-172ok-4missing-0unchecked";

const CHECKED_AT = "2026-10-03T09:24:31.074Z";
const EVIDENCE = "Full byte-level audit on self-hosted runner; GitHub Actions run 37112926137 / job 111174193227";
const MISSING_NOTES = {
  "book-4": "No direct single-PDF candidate; official archive provides a RAR package for the 12-volume umbrella collection.",
  "book-23": "No direct single-PDF candidate; official archive provides a ZIP package for the umbrella collection; individual volumes are separate catalogue records.",
  "book-32": "Official direct-PDF target returned HTTP 404; no verified alternate direct PDF recovered.",
  "book-43": "No direct single-PDF candidate; official archive provides a ZIP package for the umbrella collection; constituent works are separate catalogue records."
};
const MISSING = new Set(Object.keys(MISSING_NOTES));

export const PDF_AUDIT = Object.fromEntries(
  BOOK_CATALOG.map(book => {
    const override = PDF_CANDIDATE_OVERRIDES[book.catalog_id];
    const candidate = override?.url || book.pdf_url || null;
    const missing = MISSING.has(book.catalog_id);
    return [book.catalog_id, {
      title_ar: book.title_ar,
      candidate_url: candidate,
      status: missing ? "missing" : "available",
      url: missing ? null : candidate,
      checked_at: CHECKED_AT,
      note: missing ? MISSING_NOTES[book.catalog_id] : `Verified direct PDF. ${EVIDENCE}`
    }];
  })
);
