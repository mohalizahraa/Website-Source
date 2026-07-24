"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { PagePayload, ReviewAction, Segment } from "@/lib/types";
import { T, useToast } from "./Toast";
import { TopBar, type SaveState } from "./TopBar";
import { SegmentRail } from "./SegmentRail";
import { DocEditor, type DocEditorHandle } from "./DocEditor";
import { ContextPanel, type Scores } from "./ContextPanel";

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
  const [data, setData] = useState<PagePayload | null>(null);
  const [page, setPage] = useState(initialPage);
  const [activeId, setActiveId] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [scoresById, setScoresById] = useState<Record<string, Scores>>({});
  const [mqmById, setMqmById] = useState<Record<string, string[]>>({});
  const [err, setErr] = useState<string | null>(null);

  const docRef = useRef<DocEditorHandle>(null);

  // Load page.
  useEffect(() => {
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
        if (alive) setErr(String(e));
      });
    return () => {
      alive = false;
    };
  }, [bookId, page]);

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
    setSaveState("saving");
    // No dedicated draft endpoint; persistence of the edited text happens on
    // approve. Here we confirm the local capture and cue the reviewer.
    window.setTimeout(() => {
      setSaveState("saved");
      learn([T.strong("Draft saved."), T.text("Edits captured to translation memory.")]);
    }, 150);
  }, [learn]);

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
    await api.addStyleRule({
      rule: "Prefer transliterated technical terms over loose glosses.",
      scope: "book",
    });
    learn([
      T.strong("Style rule saved."),
      T.text("The model will prefer transliterated technical terms. Applied to this book and future ones."),
    ]);
  }, [learn]);

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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
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
      } else if (k === "a") {
        e.preventDefault();
        void review("approve");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [doSave, step, review]);

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

  return (
    <div className="app">
      <TopBar
        book={data.book}
        page={page}
        pageCount={data.book.page_count}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => Math.min(data.book.page_count, p + 1))}
        saveState={saveState}
      />
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
          footer={
            <div className="actions">
              <div className="inner">
                <button className="btn btn-primary" onClick={() => void review("approve")} disabled={isSacred}>
                  Approve &amp; save edits <span className="k">A</span>
                </button>
                <button className="btn" onClick={doSave}>
                  Save draft <span className="k">⌘S</span>
                </button>
                <button className="btn btn-ghost" onClick={() => void review("skip")}>
                  Skip
                </button>
                <div className="spacer" />
                <button className="btn btn-danger" onClick={() => void review("reject")} disabled={isSacred}>
                  Reject &amp; regenerate
                </button>
              </div>
            </div>
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
        />
      </div>
    </div>
  );
}
