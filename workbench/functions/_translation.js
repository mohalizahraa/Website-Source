import { googleDocIdFromUrl, normalizeProject } from './_lib.js';

export const TRANSLATORS = new Set(['Zahraa','Mohammed','Brother']);

function textOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeJsonArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function normalizeSourcePack(row) {
  if (!row) return {
    source_text_kind: null,
    source_text_url: null,
    recovery_routes: [],
    page_alignment_note: null,
    known_issues: null,
    resume_note: null,
    updated_at: null,
  };
  return {
    source_text_kind: textOrNull(row.source_text_kind),
    source_text_url: textOrNull(row.source_text_url),
    recovery_routes: safeJsonArray(row.recovery_routes_json),
    page_alignment_note: textOrNull(row.page_alignment_note),
    known_issues: textOrNull(row.known_issues),
    resume_note: textOrNull(row.resume_note),
    updated_at: row.updated_at || null,
  };
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2,'0')).join('');
}

export async function readPublicProgressMarker(project) {
  const docId = googleDocIdFromUrl(project?.google_doc_url);
  if (!docId) return { status: 200, data: { marker_found: false } };

  let response;
  try {
    response = await fetch(`https://docs.google.com/document/d/${docId}/export?format=txt`, {
      redirect: 'follow',
      headers: { 'user-agent': 'Haydari-Translation-Workbench/1.0' },
    });
  } catch {
    return { status: 502, data: { error: 'Could not read the public English Google Doc export.' } };
  }
  if (!response.ok) {
    return {
      status: 502,
      data: {
        error: 'Public English Google Doc export is unavailable.',
        source_status: response.status,
      },
    };
  }

  const text = await response.text();
  const matches = [...text.matchAll(/⟦WBPROGRESS:(\d+):(\d+):(\d+)⟧/g)];
  if (!matches.length) return { status: 200, data: { marker_found: false } };

  const match = matches[matches.length - 1];
  const markerProject = Number(match[1]);
  const pages = Number(match[2]);
  const total = Number(match[3]);
  if (markerProject !== Number(project.id)) {
    return { status: 409, data: { error: 'Workbench progress marker project id does not match this project.' } };
  }
  if (
    !Number.isInteger(pages) || pages < 0 ||
    !Number.isInteger(total) || total <= 0 ||
    total !== Number(project.pages || 0) ||
    pages > total
  ) {
    return { status: 409, data: { error: 'Workbench progress marker does not match the verified physical-PDF denominator.' } };
  }

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return {
    status: 200,
    data: {
      marker_found: true,
      marker_pages: pages,
      marker_total: total,
      export_sha256: hex(digest),
    },
  };
}

export async function setTranslationFocus(db, assignee, projectId) {
  if (!TRANSLATORS.has(assignee)) throw new Error('Invalid translation assignee.');
  await db.prepare(`
    INSERT INTO translation_focus(assignee, project_id, updated_at)
    VALUES(?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(assignee) DO UPDATE SET project_id=excluded.project_id, updated_at=excluded.updated_at
  `).bind(assignee, projectId).run();
}

export async function syncTranslationFocusForProject(db, project, actor = 'Unknown') {
  if (!project?.id) return;
  await db.prepare('DELETE FROM translation_focus WHERE project_id = ?').bind(project.id).run();
  if (project.status !== 'in_progress') return;

  if (TRANSLATORS.has(project.assignee)) {
    await setTranslationFocus(db, project.assignee, project.id);
    return;
  }
  if (project.assignee === 'Both' && TRANSLATORS.has(actor)) {
    await setTranslationFocus(db, actor, project.id);
  }
}

export async function resolveCurrentTranslation(db, assignee) {
  if (!TRANSLATORS.has(assignee)) return null;

  const explicit = await db.prepare(`
    SELECT p.*
    FROM translation_focus f
    JOIN projects p ON p.id=f.project_id
    WHERE f.assignee=? AND p.status='in_progress' AND (p.assignee=? OR p.assignee='Both')
    LIMIT 1
  `).bind(assignee, assignee).first();
  if (explicit) return { project: explicit, focus_source: 'explicit' };

  const derived = await db.prepare(`
    SELECT *
    FROM projects
    WHERE status='in_progress' AND (assignee=? OR assignee='Both')
    ORDER BY COALESCE(translation_progress_at, updated_at, created_at) DESC, id DESC
    LIMIT 1
  `).bind(assignee).first();
  return derived ? { project: derived, focus_source: 'derived' } : null;
}

export async function getTranslationContext(db, request, projectId) {
  const project = await db.prepare(`
    SELECT p.*, EXISTS(SELECT 1 FROM project_covers c WHERE c.project_id=p.id) AS has_uploaded_cover
    FROM projects p
    WHERE p.id=?
  `).bind(projectId).first();
  if (!project) return null;

  const [checkpoint, sourcePack, markerResult] = await Promise.all([
    db.prepare('SELECT * FROM translation_progress_checkpoints WHERE project_id=? ORDER BY id DESC LIMIT 1').bind(projectId).first(),
    db.prepare('SELECT * FROM translation_source_packs WHERE project_id=?').bind(projectId).first(),
    readPublicProgressMarker(project),
  ]);

  const storedPages = Math.max(0, Number(project.translated_pages || 0));
  const totalPages = Math.max(0, Number(project.pages || 0));
  const hasCheckpointSourceIdentity = /^[a-f0-9]{64}$/.test(String(checkpoint?.source_pdf_sha256 || '').toLowerCase());
  const markerUsable =
    markerResult.status === 200 &&
    markerResult.data?.marker_found === true &&
    hasCheckpointSourceIdentity;
  const markerPages = markerUsable ? Number(markerResult.data.marker_pages) : null;
  const effectivePages = markerPages === null ? storedPages : Math.max(storedPages, markerPages);
  const progressState =
    markerPages !== null && markerPages > storedPages ? 'verified-marker-ahead-of-d1' :
    markerPages !== null && markerPages < storedPages ? 'd1-ahead-of-marker' :
    'synchronized-or-d1-only';

  let focusedFor = [];
  if (project.status === 'in_progress') {
    const focusRows = await db.prepare('SELECT assignee FROM translation_focus WHERE project_id=? ORDER BY assignee').bind(projectId).all();
    focusedFor = (focusRows.results || []).map(row => row.assignee);
  }

  const origin = new URL(request.url).origin;
  return {
    context_version: 'translation-fast-start-v1',
    project: normalizeProject(project),
    source: {
      workbench_pdf_url: `${origin}/api/pdf/${project.id}`,
      canonical_pdf_url: project.source_pdf_url || null,
      physical_pages: totalPages || null,
      page_basis: 'physical_pdf',
      pdf_status: project.pdf_status || null,
      pdf_checked_at: project.pdf_checked_at || null,
      pdf_check_note: project.pdf_check_note || null,
      source_pdf_sha256: checkpoint?.source_pdf_sha256 || null,
    },
    target: {
      google_doc_url: project.google_doc_url || null,
      google_doc_id: googleDocIdFromUrl(project.google_doc_url),
      last_checkpoint_revision: checkpoint?.google_doc_revision || null,
    },
    progress: {
      stored_translated_pages: storedPages,
      live_marker_pages: markerPages,
      effective_translated_pages: effectivePages,
      total_pages: totalPages || null,
      next_source_page: totalPages && effectivePages < totalPages ? effectivePages + 1 : null,
      state: progressState,
      marker: totalPages ? `⟦WBPROGRESS:${project.id}:${effectivePages}:${totalPages}⟧` : null,
      sentinel: '[[NEXT_BATCH]]',
      marker_export_sha256: markerUsable ? markerResult.data.export_sha256 : null,
      marker_warning: markerResult.status === 200 ? null : markerResult.data?.error || 'Progress marker could not be verified.',
    },
    source_pack: normalizeSourcePack(sourcePack),
    resume: {
      phase: project.status,
      project_notes: project.notes || null,
      focused_for: focusedFor,
      instruction: 'Open the linked English Doc, confirm the highest verified WBPROGRESS marker and [[NEXT_BATCH]] sentinel, then continue from next_source_page using the canonical PDF plus any stored recovery witness.',
    },
  };
}
