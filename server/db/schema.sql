-- Haydari Translation Platform — authoritative SQLite schema.
-- See ARCHITECTURE.md "Data model". This file is the source of truth for all tables.
--
-- Conventions:
--   * String primary keys for domain entities (books, segments) match the API
--     wire format, e.g. book_id = "B-01", segment id = "B-01:042:03".
--   * JSON payloads are stored as TEXT (SQLite has no native JSON type; the
--     JSON1 functions still work on TEXT columns).
--   * Timestamps are ISO-8601 UTC strings (TEXT), defaulted at insert time.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- books
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS books (
    id             TEXT PRIMARY KEY,
    title_ar       TEXT NOT NULL,
    title_en       TEXT,
    author         TEXT,
    status         TEXT NOT NULL DEFAULT 'draft',
    source_pdf     TEXT,
    google_doc_url TEXT,
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------------------
-- pages  (composite PK: one row per physical page of a book)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pages (
    book_id       TEXT NOT NULL,
    page_no       INTEGER NOT NULL,
    image_path    TEXT,
    ocr_markdown  TEXT,
    status        TEXT NOT NULL DEFAULT 'draft',
    PRIMARY KEY (book_id, page_no),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- segments  (the unit of translation + review)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS segments (
    id                TEXT PRIMARY KEY,          -- e.g. "B-01:042:03"
    book_id           TEXT NOT NULL,
    page_no           INTEGER NOT NULL,
    seg_order         INTEGER NOT NULL,
    kind              TEXT NOT NULL DEFAULT 'body'
                          CHECK (kind IN ('body', 'footnote', 'sacred')),
    anchor            TEXT,                      -- e.g. "FN-1" for footnote segments
    ar                TEXT NOT NULL,
    en_draft          TEXT,                      -- first machine draft (immutable-ish)
    en_current        TEXT,                      -- latest text shown/edited
    engine            TEXT,
    confidence        REAL,
    bt_sim            REAL,
    self_consistency  REAL,
    judge_score       REAL,
    judge_note        TEXT,
    footnote_ok       INTEGER,                   -- 0/1/NULL (SQLite has no bool)
    alternatives      TEXT,                      -- JSON array of alternative renderings
    status            TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'needs_review', 'approved')),
    updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    FOREIGN KEY (book_id, page_no) REFERENCES pages(book_id, page_no) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_segments_book_page
    ON segments (book_id, page_no, seg_order);
CREATE INDEX IF NOT EXISTS idx_segments_status
    ON segments (status);

-- ---------------------------------------------------------------------------
-- translation_memory  (approved ar -> en pairs, with embedding for retrieval)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS translation_memory (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id      TEXT,
    ar_hash      TEXT NOT NULL,                  -- hash of normalized ar
    ar           TEXT NOT NULL,
    en_approved  TEXT NOT NULL,
    embedding    BLOB,                           -- packed float32 vector
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL
);

-- One TM row per (book, normalized-arabic) so upserts are idempotent.
-- COALESCE(book_id,'') is required because SQLite treats each NULL as distinct,
-- so a plain (book_id, ar_hash) index would NOT dedupe global (book_id NULL)
-- rows. The sentinel makes the uniqueness hold for global entries too.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tm_book_arhash
    ON translation_memory (COALESCE(book_id, ''), ar_hash);

-- ---------------------------------------------------------------------------
-- termbase  (glossary; global or per-book scope)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS termbase (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    term_ar     TEXT NOT NULL,
    term_en     TEXT NOT NULL,
    note        TEXT,
    scope       TEXT NOT NULL DEFAULT 'global'
                    CHECK (scope IN ('global', 'book')),
    book_id     TEXT,
    created_by  TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_termbase_scope ON termbase (scope, book_id);
CREATE INDEX IF NOT EXISTS idx_termbase_term_ar ON termbase (term_ar);

-- ---------------------------------------------------------------------------
-- style_rules  (freeform reviewer guidance; global or per-book)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS style_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    rule        TEXT NOT NULL,
    scope       TEXT NOT NULL DEFAULT 'global'
                    CHECK (scope IN ('global', 'book')),
    book_id     TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_style_rules_scope ON style_rules (scope, book_id);

-- ---------------------------------------------------------------------------
-- corrections  (THE training signal: draft->edited pairs captured on review)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS corrections (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    segment_id     TEXT NOT NULL,
    en_before      TEXT,
    en_after       TEXT,
    diff_json      TEXT,                         -- token-level diff ops (JSON)
    mqm_tags_json  TEXT,                         -- MQM error tags (JSON array)
    dims_json      TEXT,                         -- reviewer scores by dimension (JSON)
    reviewer       TEXT,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_corrections_segment ON corrections (segment_id);

-- ---------------------------------------------------------------------------
-- events  (append-only audit / provenance log; written on every mutation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    actor        TEXT,
    type         TEXT NOT NULL,
    payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events (type);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts);
