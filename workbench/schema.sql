PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_ar TEXT NOT NULL,
  title_en TEXT,
  catalog_id TEXT,
  translit TEXT,
  author TEXT,
  author_ar TEXT,
  category TEXT,
  topic_en TEXT,
  topic_ar TEXT,
  package_url TEXT,
  pages INTEGER,
  volumes INTEGER,
  catalog_date TEXT,
  assignee TEXT NOT NULL DEFAULT 'Unassigned' CHECK (assignee IN ('Zahraa','Mohammed','Brother','Both','Unassigned')),
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','review','completed','published')),
  source_url TEXT,
  source_pdf_url TEXT,
  pdf_status TEXT NOT NULL DEFAULT 'unchecked' CHECK (pdf_status IN ('unchecked','available','missing')),
  pdf_checked_at TEXT,
  pdf_check_note TEXT,
  google_doc_url TEXT,
  translated_pages INTEGER NOT NULL DEFAULT 0 CHECK (translated_pages >= 0),
  translation_progress_at TEXT,
  cover_url TEXT,
  start_date TEXT,
  due_date TEXT,
  notes TEXT,
  completed_at TEXT,
  completed_by TEXT,
  published_at TEXT,
  published_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_catalog_id ON projects(catalog_id) WHERE catalog_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_assignee ON projects(assignee);
CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity(created_at DESC);

CREATE TABLE IF NOT EXISTS translation_progress_checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  from_pages INTEGER NOT NULL,
  to_pages INTEGER NOT NULL,
  source_total_pages INTEGER NOT NULL,
  source_page_basis TEXT NOT NULL DEFAULT 'physical_pdf',
  source_pdf_sha256 TEXT NOT NULL,
  google_doc_revision TEXT NOT NULL,
  verification_note TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_translation_progress_project_created ON translation_progress_checkpoints(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS translation_focus (
  assignee TEXT PRIMARY KEY CHECK (assignee IN ('Zahraa','Mohammed','Brother')),
  project_id INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_translation_focus_project ON translation_focus(project_id);

CREATE TABLE IF NOT EXISTS translation_source_packs (
  project_id INTEGER PRIMARY KEY,
  source_text_kind TEXT,
  source_text_url TEXT,
  recovery_routes_json TEXT NOT NULL DEFAULT '[]',
  page_alignment_note TEXT,
  known_issues TEXT,
  resume_note TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS project_covers (
  project_id INTEGER PRIMARY KEY,
  mime_type TEXT NOT NULL,
  image_bytes BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
