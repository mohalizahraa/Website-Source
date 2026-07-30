"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import type { Segment } from "@/lib/types";
import { diffWords, levelOf, tokenizeBody } from "@/lib/ui";

export interface DocEditorHandle {
  getText(id: string): string;
  getTexts(): Record<string, string>;
  setText(id: string, text: string): void;
  focusSegment(id: string): void;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Footnote anchors -> non-editable superscripts; other text escaped.
function plainHTML(text: string): string {
  return tokenizeBody(text)
    .map((tok) =>
      tok.type === "fn"
        ? `<sup class="fn" contenteditable="false" data-fn="${tok.anchor}">${tok.n}</sup>`
        : esc(tok.value),
    )
    .join("");
}

// Inline tracked-changes (draft -> current) as ins/del.
function diffHTML(draft: string, current: string): string {
  // Diff the complete wire text, including [[FN-n]] anchors. Each diff run is
  // then rendered through plainHTML so anchors remain non-editable superscripts
  // instead of disappearing after the first saved edit.
  return diffWords(draft, current)
    .map((t) => {
      const v = plainHTML(t.value);
      if (t.type === "ins") return `<ins>${v}</ins>`;
      if (t.type === "del") return `<del>${v}</del>`;
      return v;
    })
    .join("");
}

// Read the current plain text from an editable node, excluding struck words
// while restoring protected footnote markers to their stable API tokens.
export function readEditable(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("del, .tag").forEach((n) => n.remove());
  // Convert visible, protected footnote superscripts back to the API's stable
  // [[FN-n]] tokens before reading textContent.
  clone.querySelectorAll<HTMLElement>("sup.fn").forEach((node) => {
    const anchor = node.dataset.fn;
    node.replaceWith(document.createTextNode(anchor ? `[[${anchor}]]` : ""));
  });
  return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

export const DocEditor = forwardRef<
  DocEditorHandle,
  {
    segments: Segment[];
    activeId: string;
    chapterTitle?: string;
    onSelect: (id: string) => void;
    onDirty: (id: string, text: string) => void;
    footer?: React.ReactNode;
    readOnly?: boolean; // read-only view for anon/reader visitors (no editing)
  }
>(function DocEditor(
  {
    segments,
    activeId,
    chapterTitle = "Chapter Two — On the Reality of Existence",
    onSelect,
    onDirty,
    footer,
    readOnly = false,
  },
  ref,
) {
  const nodes = useRef<Map<string, HTMLElement>>(new Map());

  const body = useMemo(() => segments.filter((s) => s.kind !== "footnote"), [segments]);
  const footnotes = useMemo(() => segments.filter((s) => s.kind === "footnote"), [segments]);

  const setNode = useCallback((id: string, el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      getText(id) {
        const el = nodes.current.get(id);
        const seg = segments.find((s) => s.id === id);
        return el ? readEditable(el) : seg ? seg.en.trim() : "";
      },
      getTexts() {
        const out: Record<string, string> = {};
        segments.forEach((s) => {
          const el = nodes.current.get(s.id);
          out[s.id] = el ? readEditable(el) : s.en.trim();
        });
        return out;
      },
      setText(id, text) {
        const el = nodes.current.get(id);
        if (!el) return;
        const seg = segments.find((s) => s.id === id);
        const draft = seg?.en_draft ?? seg?.en ?? "";
        // Show the applied text as a tracked change against the model draft.
        el.innerHTML = diffHTML(draft, text);
        onDirty(id, readEditable(el));
      },
      focusSegment(id) {
        const el = nodes.current.get(id);
        if (el) {
          el.focus();
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      },
    }),
    [segments, onDirty],
  );

  // Scroll the active segment into view when selection changes.
  useEffect(() => {
    const el = nodes.current.get(activeId);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion:reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  }, [activeId]);

  return (
    <div className="editor-wrap">
      <div className="doc">
        <div className="doc-head">
          <div className="kicker">
            {readOnly ? "Translation · read only" : "Draft translation · edit freely"}
          </div>
          <h1>{chapterTitle}</h1>
          <div className="sub">
            {readOnly
              ? "You have read-only access to this translation. Editing and review require a creator account."
              : "Your edits are tracked and become training signal. Green segments are pre-approved; jump to the red ones."}
          </div>
        </div>

        <div className="prose">
          {body.map((s) => {
            const lvl = levelOf(s);
            const sacred = s.kind === "sacred";
            const edited = !!s.en_draft && s.en_draft !== s.en;
            // Sacred segments keep their golden styling but are now EDITABLE: a
            // canonical hit shows "canonical"; a fallback/blank asks you to verify.
            const canonical = sacred && s.engine === "canonical";
            const tag = sacred
              ? canonical
                ? "Qurʾān · canonical"
                : "Qurʾān · verify translation"
              : edited
                ? "edited by you"
                : `${Math.round(s.confidence * 100)}% confidence`;
            const initialHTML = edited ? diffHTML(s.en_draft!, s.en) : plainHTML(s.en);
            return (
              <div
                key={s.id}
                ref={(el) => setNode(s.id, el)}
                data-id={s.id}
                className={"seg lvl-" + lvl + (sacred ? " sacred" : "") + (s.id === activeId ? " active" : "")}
                contentEditable={!readOnly}
                suppressContentEditableWarning
                spellCheck={false}
                role="textbox"
                aria-multiline="true"
                aria-readonly={readOnly}
                aria-label={
                  readOnly
                    ? "Translation segment (read only)"
                    : sacred
                      ? "Sacred segment (editable, verify canonical wording)"
                      : "Editable translation segment"
                }
                onClick={() => onSelect(s.id)}
                onFocus={() => onSelect(s.id)}
                onInput={
                  readOnly
                    ? undefined
                    : (event) => onDirty(s.id, readEditable(event.currentTarget))
                }
                dangerouslySetInnerHTML={{
                  __html: `<span class="tag" contenteditable="false">${tag}</span>` + initialHTML,
                }}
              />
            );
          })}
        </div>

        {footnotes.length > 0 && (
          <div className="footnotes">
            <div className="fh">Footnotes</div>
            {footnotes.map((f) => {
              const n = f.anchor?.replace("FN-", "") ?? "•";
              const canonical = /canonical/i.test(f.engine);
              const edited = !!f.en_draft && f.en_draft !== f.en;
              const initialHTML = edited ? diffHTML(f.en_draft!, f.en) : plainHTML(f.en);
              return (
                <div className="fnote" key={f.id}>
                  <span className="n">{n}</span>
                  <div>
                    <span
                      ref={(el) => setNode(f.id, el)}
                      data-id={f.id}
                      className={f.id === activeId ? "active" : ""}
                      contentEditable={!readOnly}
                      suppressContentEditableWarning
                      role="textbox"
                      aria-label={readOnly ? `Footnote ${n} (read only)` : `Editable footnote ${n}`}
                      aria-readonly={readOnly}
                      onClick={() => onSelect(f.id)}
                      onFocus={() => onSelect(f.id)}
                      onInput={
                        readOnly
                          ? undefined
                          : (event) => onDirty(f.id, readEditable(event.currentTarget))
                      }
                      dangerouslySetInnerHTML={{ __html: initialHTML }}
                    />
                    {canonical && <span className="canon">✦ canonical source matched</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {footer}
    </div>
  );
});
