"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type {
  IngestStatus,
  LLMReviewResult,
  PagePayload,
  ReviewAction,
  Scope,
  Segment,
} from "@/lib/types";
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
  const [actionBusy, setActionBusy] = useState<ReviewAction | "draft" | null>(null);
  const [llmById, setLlmById] = useState<Record<string, LLMReviewResult>>({});
  const [llmReviewingId, setLlmReviewingId] = useState<string | null>(null);

  const docRef = useRef<DocEditorHandle>(null);
  const pagesRef = useRef<number[]>([]);
  const loadedOnceRef = useRef(false); // have we ever fetched the page list OK?
  const pendingDraftsRef = useRef<Record<string, string>>({});
  const saveTimersRef = useRef<Map<string, number>>(new Map());
  const saveChainsRef = useRef<Map<string, Promise<void>>>(new Map());

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

  const patchSegment = useCallback((id: string, patch: Partial<Segment>) => {
    setData((d) =>
      d ? { ...d, segments: d.segments.map((s) => (s.id === id ? { ...s, ...patch } : s)) } : d,
    );
  }, []);

  const persistDraft = useCallback(
    (id: string, text: string, announce = false): Promise<void> => {
      const timer = saveTimersRef.current.get(id);
      if (timer !== undefined) window.clearTimeout(timer);
      saveTimersRef.current.delete(id);
      setSaveState("saving");

      // Serialize saves per segment so a slower old request can never overwrite
      // a newer edit at the database.
      const previous = saveChainsRef.current.get(id) ?? Promise.resolve();
      const task = previous
        .catch(() => undefined)
        .then(async () => {
          const saved = await api.saveSegmentDraft(id, text);
          if (pendingDraftsRef.current[id] === text) {
            delete pendingDraftsRef.current[id];
            setSaveState(
              Object.keys(pendingDraftsRef.current).length === 0 ? "saved" : "unsaved",
            );
          }
          // Updating status is safe while typing; avoid replacing `en` in React
          // state because dangerouslySetInnerHTML would move the active caret.
          patchSegment(id, { status: saved.status, en_draft: saved.en_draft });
          if (announce) {
            learn([T.strong("Draft saved."), T.text("It will be restored when you return.")]);
          }
        })
        .catch((error) => {
          setSaveState("unsaved");
          if (announce) {
            learn([T.strong("Draft was not saved."), T.text(String(error))]);
          }
          throw error;
        });
      saveChainsRef.current.set(id, task);
      return task;
    },
    [learn, patchSegment],
  );

  const markDirty = useCallback(
    (id: string, text: string) => {
      if (!manage) return;
      pendingDraftsRef.current[id] = text;
      setSaveState("unsaved");
      const old = saveTimersRef.current.get(id);
      if (old !== undefined) window.clearTimeout(old);
      const timer = window.setTimeout(() => {
        void persistDraft(id, text).catch(() => undefined);
      }, 700);
      saveTimersRef.current.set(id, timer);
    },
    [manage, persistDraft],
  );

  const doSave = useCallback(async () => {
    if (!manage || !active) return;
    const text = docRef.current?.getText(active.id) ?? active.en;
    pendingDraftsRef.current[active.id] = text;
    setActionBusy("draft");
    try {
      await persistDraft(active.id, text, true);
    } catch {
      // persistDraft already leaves the visible state unsaved and explains why.
    } finally {
      setActionBusy(null);
    }
  }, [active, manage, persistDraft]);

  const flushPending = useCallback(async () => {
    const entries = Object.entries(pendingDraftsRef.current);
    if (!entries.length) return true;
    const results = await Promise.allSettled(entries.map(([id, text]) => persistDraft(id, text)));
    return results.every((result) => result.status === "fulfilled");
  }, [persistDraft]);

  const select = useCallback(
    (id: string) => {
      if (id === activeId) return;
      const pending = pendingDraftsRef.current[activeId];
      if (!(activeId in pendingDraftsRef.current)) {
        setActiveId(id);
        setSaveState(
          Object.keys(pendingDraftsRef.current).length === 0 ? "saved" : "unsaved",
        );
        return;
      }
      void persistDraft(activeId, pending)
        .then(() => setActiveId(id))
        .catch(() => undefined);
    },
    [activeId, persistDraft],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      const ids = railSegments.map((s) => s.id);
      const idx = ids.indexOf(activeId);
      const next = ids[Math.min(ids.length - 1, Math.max(0, idx + dir))];
      if (next) select(next);
    },
    [railSegments, activeId, select],
  );

  const review = useCallback(
    async (action: ReviewAction) => {
      if (!active || actionBusy) return;
      const en_edited = docRef.current?.getText(active.id) ?? active.en;
      // Training signal: does the final text differ from the model's ORIGINAL
      // draft (en_draft when present, else the current en)?
      const draft = (active.en_draft ?? active.en).replace(/\[\[FN-\d+\]\]/g, "").trim();
      const changed = en_edited.replace(/\[\[FN-\d+\]\]/g, "").trim() !== draft;
      const timer = saveTimersRef.current.get(active.id);
      if (timer !== undefined) window.clearTimeout(timer);
      saveTimersRef.current.delete(active.id);
      setActionBusy(action);
      try {
        // If the debounce already fired, wait for that older draft write before
        // sending the final action. Otherwise a slow autosave could land after
        // Approve/Reject and incorrectly move the segment back to `draft`.
        await saveChainsRef.current.get(active.id)?.catch(() => undefined);
        const res = await api.reviewSegment(active.id, {
          en_edited,
          action,
          scores,
          mqm,
        });
        delete pendingDraftsRef.current[active.id];
        patchSegment(active.id, { status: res.status, en: en_edited });
        setSaveState("saved");
        if (action === "approve") {
          learn(
            changed
              ? [
                  T.strong("Approved."),
                  T.text("Your edits were stored as a training pair — the model just learned a little of your voice."),
                ]
              : [T.strong("Approved."), T.text("Segment locked into the approved set.")],
          );
        } else if (action === "reject") {
          learn([T.strong("Rejected."), T.text("Your edit was saved and the segment remains in review.")]);
          step(1);
        } else {
          learn([T.strong("Skipped."), T.text("Your current edit was saved without approving it.")]);
          step(1);
        }
      } catch (e) {
        setSaveState("unsaved");
        learn([T.strong("Something went wrong."), T.text(String(e))]);
      } finally {
        setActionBusy(null);
      }
    },
    [active, actionBusy, scores, mqm, patchSegment, learn, step],
  );

  const applyAlt = useCallback(
    (text: string) => {
      if (!active) return;
      docRef.current?.setText(active.id, text);
      setSaveState("unsaved");
      learn([T.strong("Applied."), T.text("Review the replacement, then save or approve it.")]);
    },
    [active, learn],
  );

  const teachTerm = useCallback(async (termAr: string, termEn: string, scope: Scope) => {
    try {
      await api.addTerm({
        term_ar: termAr,
        term_en: termEn,
        scope,
        book_id: scope === "book" ? bookId : undefined,
      });
      learn([
        T.strong("Term learned."),
        T.ar(`${termAr} → ${termEn}`),
        T.text(scope === "book" ? "Saved for this book." : "Saved for all books."),
      ]);
    } catch (e) {
      learn([T.strong("Couldn’t save term."), T.text(String(e))]);
      throw e;
    }
  }, [learn, bookId]);

  const teachStyle = useCallback(async (rule: string, scope: Scope) => {
    try {
      await api.addStyleRule({
        rule,
        scope,
        book_id: scope === "book" ? bookId : undefined,
      });
      learn([
        T.strong("Style rule saved."),
        T.text(scope === "book" ? "It will guide this book." : "It will guide all books."),
      ]);
    } catch (e) {
      learn([T.strong("Couldn’t save style rule."), T.text(String(e))]);
      throw e;
    }
  }, [learn, bookId]);

  const requestLLMReview = useCallback(async () => {
    if (!active || llmReviewingId) return;
    const text = docRef.current?.getText(active.id) ?? active.en;
    setLlmReviewingId(active.id);
    try {
      const result = await api.reviewWithLLM(active.id, text);
      setLlmById((current) => ({ ...current, [active.id]: result }));
      learn([T.strong("LLM review ready."), T.text("Nothing was changed automatically.")]);
    } catch (e) {
      learn([T.strong("LLM review failed."), T.text(String(e))]);
    } finally {
      setLlmReviewingId(null);
    }
  }, [active, learn, llmReviewingId]);

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

  // Autosave normally finishes within 700 ms. If the tab is hidden, start any
  // pending writes immediately; if the browser is closing while a request is
  // still unsaved, show its native leave warning instead of silently losing it.
  useEffect(() => {
    if (!manage) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flushPending();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (Object.keys(pendingDraftsRef.current).length === 0) return;
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [flushPending, manage]);

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
        onBack={async () => {
          if (await flushPending()) router.push("/");
        }}
        onPrev={() => {
          if (prevPage != null) void flushPending().then((ok) => ok && setPage(prevPage));
        }}
        onNext={() => {
          if (nextPage != null) void flushPending().then((ok) => ok && setPage(nextPage));
        }}
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
                  <button className="btn btn-primary" disabled={actionBusy !== null} onClick={() => void review("approve")}>
                    Approve &amp; save edits <span className="k">A</span>
                  </button>
                  <button className="btn" disabled={actionBusy !== null} onClick={() => void doSave()}>
                    {actionBusy === "draft" ? "Saving…" : "Save draft"} <span className="k">⌘S</span>
                  </button>
                  <button className="btn btn-ghost" disabled={actionBusy !== null} onClick={() => void review("skip")}>
                    Skip
                  </button>
                  <div className="spacer" />
                  <button className="btn btn-danger" disabled={actionBusy !== null} onClick={() => void review("reject")}>
                    Reject
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
          onLLMReview={requestLLMReview}
          llmReview={llmById[active.id] ?? null}
          llmReviewing={llmReviewingId === active.id}
          readOnly={!manage}
        />
      </div>
      {manage && <ChatWidget bookId={bookId} bookTitle={data.book.title_en || data.book.title_ar} />}
    </div>
  );
}
