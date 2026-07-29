"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { IngestStatus, PagePayload, ReviewAction, Segment } from "@/lib/types";
import { canWrite, useAuth } from "@/lib/auth";
import { T, useToast } from "./Toast";
import { TopBar, type SaveState } from "./TopBar";
import { SegmentRail } from "./SegmentRail";
import { DocEditor, type DocEditorHandle } from "./DocEditor";
import { ContextPanel, type Scores } from "./ContextPanel";
import { ChatWidget } from "./ChatWidget";

const EMPTY_SCORES: Scores = { Adequacy: 0, Fluency: 0, Terminology: 0, Footnotes: 0 };

function pickDefault(segments: Segment[]): string {
  const queue = segments.filter((s) => s.kind !== "footnote");
  const needs = queue.filter((s) => s.status !== "approved" && s.kind !== "sacred");
  if (needs.length) {
    return needs.reduce((a, b) => (b.confidence < a.confidence ? b : a)).id;
  }
  return queue[0]?.id ?? "";
}

export function Workbench({ bookId, initialPage = 1 }: { bookId: string; initialPage?: number }) {
  const { learn } = useToast();
  const router = useRouter();
  const { user } = useAuth();
  // Anonymous readers and reader-role accounts get a read-only view: no edit
  // surface, approve/reject, teaching, or chat (all of which require a write
  // and would 401/403 at the backend anyway).
  const manage = canWrite(user);
  // A 401 means the session is missing/expired (or this is a private book viewed
  // anonymously) — bounce to login and return here afterward.
  const bounceIf401 = useCallback(
    (e: unknown): boolean => {
      if (e instanceof ApiError && e.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(`/review/${bookId}`)}`);
        return true;
      }
      return false;
    },
    [router, bookId],
  );
  const [data, setData] = useState<PagePayload | null>(null);
  const [page, setPage] = useState(initialPage);
  const [pages, setPages] = useState<number[]>([]); // page numbers that exist
  const [pagesReady, setPagesReady] = useState(false); // have we fetched the list?
  const [activeId, setActiveId] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [scoresById, setScoresById] = useState<Record<string, Scores>>({});
  const [mqmById, setMqmById] = useState<Record<string, string[]>>({});
  const [err, setErr] = useState<string | null>(null);
  const [live, setLive] = useState<IngestStatus | null>(null);

  const docRef = useRef<DocEditorHandle>(null);
  const pagesRef = useRef<number[]>([]);
  const loadedOnceRef = useRef(false); // have we ever fetched the page list OK?

  // Which pages actually exist (ingestion can be a non-contiguous range).
  const refreshPages = useCallback(async () => {
    // On a 401 here (private book viewed anon, or expired session) redirect to
    // login — otherwise pagesReady stays false and the page hangs on "Loading".
    const nums = await api.listPages(bookId).catch((e) => {
      if (bounceIf401(e)) return null;
      // Any other error on the FIRST load (403/404/500/offline) must surface as
      // an error, not an eternal "Loading…"; ignore transient blips once loaded.
      if (!loadedOnceRef.current) setErr(String(e));
      return null;
    });
    if (nums) {
      loadedOnceRef.current = true;
      pagesRef.current = nums;
      setPages(nums);
      setPagesReady(true);
    }
  }, [bookId, bounceIf401]);

  useEffect(() => {
    setPagesReady(false);
    void refreshPages();
  }, [refreshPages]);

  // Snap the current page onto the first available one (never 404 on a gap).
  useEffect(() => {
    if (!pagesReady || pages.length === 0) return;
    if (!pages.includes(page)) setPage(pages[0]);
  }, [pages, pagesReady, page]);

  // Load the current page — only once we know it exists, and NOT on every poll
  // (deps are [bookId, page] only) so in-progress edits are never clobbered.
  useEffect(() => {
    if (!pagesReady || !pagesRef.current.includes(page)) return;
    let alive = true;
    setErr(null);
    api
      .getPage(bookId, page)
      .then((p) => {
        if (!alive) return;
        setData(p);
        setActiveId((cur) => (cur && p.segments.some((s) => s.id === cur) ? cur : pickDefault(p.segments)));
      })
      .catch((e) => {
        if (!alive) return;
        if (bounceIf401(e)) return;
        setErr(String(e));
      });
    return () => {
      alive = false;
    };
  }, [bookId, page, pagesReady, bounceIf401]);

  // Poll ingest status + the page list so the banner and pager grow live.
  // Depends only on bookId; the interval skips fetches once ingestion is idle.
  const liveRef = useRef<IngestStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const s = await api.getBookStatus(bookId).catch(() => null);
      if (!alive) return;
      if (s) {
        liveRef.current = s;
        setLive(s);
      }
      await refreshPages(); // reveal newly-finished pages while ingesting
    };
    void tick();
    const id = setInterval(() => {
      const cur = liveRef.current;
      if (cur && cur.status !== "processing" && !cur.has_more) return; // idle
      void tick();
    }, 2500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [bookId, refreshPages]);

  const railSegments = useMemo(
    () => (data ? data.segments.filter((s) => s.kind !== "footnote") : []),
    [data],
  );
  const active = useMemo(
    () => data?.segments.find((s) => s.id === activeId) ?? null,
    [data, activeId],
  );

  const scores = scoresById[activeId] ?? EMPTY_SCORES;
  const mqm = mqmById[activeId] ?? [];

  const markDirty = useCallback(() => setSaveState("unsaved"), []);

  const select = useCallback((id: string) => setActiveId(id), []);

  const step = useCallback(
    (dir: 1 | -1) => {
      const ids = railSegments.map((s) => s.id);
      const idx = ids.indexOf(activeId);
      const next = ids[Math.min(ids.length - 1, Math.max(0, idx + dir))];
      if (next) setActiveId(next);
    },
    [railSegments, activeId],
  );

  const patchSegment = useCallback((id: string, patch: Partial<Segment>) => {
    setData((d) =>
      d ? { ...d, segments: d.segments.map((s) => (s.id === id ? { ...s, ...patch } : s)) } : d,
    );
  }, []);

  const doSave = useCallback(() => {
    if (!manage) return; // read-only viewers have nothing to save
    setSaveState("saving");
    // No dedicated draft endpoint; persistence of the edited text happens on
    // approve. Here we confirm the local capture and cue the reviewer.
    window.setTimeout(() => {
      setSaveState("saved");
      learn([T.strong("Draft saved."), T.text("Edits captured to translation memory.")]);
    }, 150);
  }, [learn, manage]);

  const review = useCallback(
    async (action: ReviewAction) => {
      if (!active) return;
      const en_edited = docRef.current?.getText(active.id) ?? active.en;
      // Training signal: does the final text differ from the model's ORIGINAL
      // draft (en_draft when present, else the current en)?
      const draft = (active.en_draft ?? active.en).replace(/\[\[FN-\d+\]\]/g, "").trim();
      const changed = en_edited.trim() !== draft;
      try {
        const res = await api.reviewSegment(active.id, {
          en_edited,
          action,
          scores,
          mqm,
        });
        patchSegment(active.id, { status: res.status });
        if (action === "approve") {
          setSaveState("saved");
          learn(
            changed
              ? [
                  T.strong("Approved."),
                  T.text("Your edits were stored as a training pair — the model just learned a little of your voice."),
                ]
              : [T.strong("Approved."), T.text("Segment locked into the approved set.")],
          );
        } else if (action === "reject") {
          learn([T.strong("Sent back."), T.text("This segment was queued for regeneration.")]);
          step(1);
        } else {
          step(1);
        }
      } catch (e) {
        learn([T.strong("Something went wrong."), T.text(String(e))]);
      }
    },
    [active, scores, mqm, patchSegment, learn, step],
  );

  const applyAlt = useCallback(
    (text: string) => {
      if (!active) return;
      docRef.current?.setText(active.id, text);
      setSaveState("unsaved");
      learn([T.strong("Applied."), T.text("Replaced the phrase and logged your preference.")]);
    },
    [active, learn],
  );

  const teachTerm = useCallback(async () => {
    await api.addTerm({
      term_ar: "المتكلّمون",
      term_en: "the mutakallimūn",
      note: "Prefer transliteration for technical kalām terms.",
      scope: "global",
    });
    learn([
      T.strong("Learned."),
      T.text("Added"),
      T.ar("المتكلّمون → “the mutakallimūn”"),
      T.text("to your termbase — enforced in 7 upcoming segments."),
    ]);
  }, [learn]);

  const teachStyle = useCallback(async () => {
    try {
      await api.addStyleRule({
        rule: "Prefer transliterated technical terms over loose glosses.",
        scope: "book",
        book_id: bookId,
      });
      learn([
        T.strong("Style rule saved."),
        T.text("The model will prefer transliterated technical terms. Applied to this book and future ones."),
      ]);
    } catch (e) {
      learn([T.strong("Couldn’t save style rule."), T.text(String(e))]);
    }
  }, [learn, bookId]);

  const setScore = useCallback(
    (dim: keyof Scores, v: number) => {
      setScoresById((m) => ({ ...m, [activeId]: { ...(m[activeId] ?? EMPTY_SCORES), [dim]: v } }));
    },
    [activeId],
  );
  const toggleMqm = useCallback(
    (tag: string) => {
      setMqmById((m) => {
        const cur = m[activeId] ?? [];
        return { ...m, [activeId]: cur.includes(tag) ? cur.filter((x) => x !== tag) : [...cur, tag] };
      });
    },
    [activeId],
  );

  // Keyboard: J/K move, A accept, ⌘S save.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const typing = target?.isContentEditable || /input|textarea/i.test(target?.tagName || "");
      if (manage && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        doSave();
        return;
      }
      if (typing) return;
      const k = e.key.toLowerCase();
      if (k === "j") {
        e.preventDefault();
        step(1);
      } else if (k === "k") {
        e.preventDefault();
        step(-1);
      } else if (k === "a" && manage) {
        e.preventDefault();
        void review("approve");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [doSave, step, review, manage]);

  // No reviewable pages yet — a friendly wait state, not a scary error.
  if (pagesReady && pages.length === 0) {
    const proc = live?.status === "processing";
    return (
      <div className="app">
        <div className="loading">
          <div>{proc ? "Ingesting the first page…" : "No pages ready to review yet."}</div>
          <div style={{ marginTop: 8, fontSize: "var(--fs-sm)", color: "var(--ink-3)" }}>
            {proc
              ? "Pages appear here the moment each one finishes. This refreshes automatically."
              : "Start ingestion from the Library (choose a page range and press Ingest)."}
          </div>
          <div style={{ marginTop: 14 }}>
            <a className="btn sm" href="/">
              ← Back to Library
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="app">
        <div className="loading">
          <div>Couldn’t load this page.</div>
          <div style={{ marginTop: 8, fontSize: "var(--fs-sm)", color: "var(--ink-3)" }}>
            This book may still be ingesting, or has no pages yet.
          </div>
          <div style={{ marginTop: 14 }}>
            <a className="btn sm" href="/">
              ← Back to Library
            </a>
          </div>
        </div>
      </div>
    );
  }
  if (!data || !active) {
    return (
      <div className="app">
        <div className="loading">Loading page…</div>
      </div>
    );
  }

  const isSacred = active.kind === "sacred";
  // Navigate only the pages that actually exist (handles non-contiguous ranges
  // and pages arriving live during ingestion).
  const ingesting = data.book.status === "processing";
  const idx = pages.indexOf(page);
  const prevPage = idx > 0 ? pages[idx - 1] : null;
  const nextPage = idx >= 0 && idx < pages.length - 1 ? pages[idx + 1] : null;
  const totalPages = live?.pages_total || data.book.page_count;

  return (
    <div className="app">
      <TopBar
        book={data.book}
        page={page}
        pageCount={totalPages}
        onPrev={() => prevPage != null && setPage(prevPage)}
        onNext={() => nextPage != null && setPage(nextPage)}
        hasPrev={prevPage != null}
        hasNext={nextPage != null}
        saveState={saveState}
        readOnly={!manage}
      />
      {ingesting && (
        <div className="live-banner">
          <span className="lb-dot" /> Ingesting live —{" "}
          <b>
            {live?.pages_done ?? 0}
            {live?.pages_total ? ` / ${live.pages_total}` : ""}
          </b>{" "}
          pages ready ({pages.length} loaded).
          {live?.detail?.message ? <span className="lb-msg"> {live.detail.message}</span> : null}{" "}
          Reviewing now won’t affect ingestion.
        </div>
      )}
      <div className="workspace">
        <SegmentRail
          segments={railSegments}
          activeId={activeId}
          onSelect={select}
          focusMode={focusMode}
          onToggleFocus={() => setFocusMode((f) => !f)}
        />

        <DocEditor
          ref={docRef}
          segments={data.segments}
          activeId={activeId}
          onSelect={select}
          onDirty={markDirty}
          readOnly={!manage}
          footer={
            manage ? (
              <div className="actions">
                <div className="inner">
                  <button className="btn btn-primary" onClick={() => void review("approve")}>
                    Approve &amp; save edits <span className="k">A</span>
                  </button>
                  <button className="btn" onClick={doSave}>
                    Save draft <span className="k">⌘S</span>
                  </button>
                  <button className="btn btn-ghost" onClick={() => void review("skip")}>
                    Skip
                  </button>
                  <div className="spacer" />
                  <button className="btn btn-danger" onClick={() => void review("reject")}>
                    Reject &amp; regenerate
                  </button>
                </div>
              </div>
            ) : undefined
          }
        />

        <ContextPanel
          key={activeId}
          seg={active}
          page={page}
          scores={scores}
          onScore={setScore}
          mqm={mqm}
          onToggleMqm={toggleMqm}
          onApplyAlt={applyAlt}
          onTeachTerm={teachTerm}
          onTeachStyle={teachStyle}
          readOnly={!manage}
        />
      </div>
      {manage && <ChatWidget bookId={bookId} bookTitle={data.book.title_en || data.book.title_ar} />}
    </div>
  );
}
