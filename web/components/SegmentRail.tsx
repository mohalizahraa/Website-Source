"use client";

import type { Segment } from "@/lib/types";
import { levelOf, preview } from "@/lib/ui";

const RING_CIRC = 2 * Math.PI * 17; // r = 17

export function SegmentRail({
  segments,
  activeId,
  onSelect,
  focusMode,
  onToggleFocus,
}: {
  segments: Segment[]; // body + sacred only (rail queue)
  activeId: string;
  onSelect: (id: string) => void;
  focusMode: boolean;
  onToggleFocus: () => void;
}) {
  const total = segments.length;
  const approved = segments.filter((s) => s.status === "approved").length;
  const fraction = total ? approved / total : 0;
  const percent = Math.round(fraction * 100);

  return (
    <aside className={"rail" + (focusMode ? " focusing" : "")} aria-label="Segments">
      <div className="rail-head">
        <div className="eyebrow">Review queue</div>
        <div className="progress">
          <svg className="ring" viewBox="0 0 42 42" role="img" aria-label={`${percent}% approved`}>
            <circle cx="21" cy="21" r="17" fill="none" stroke="var(--line)" strokeWidth="4" />
            <circle
              cx="21"
              cy="21"
              r="17"
              fill="none"
              stroke="var(--lapis)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={RING_CIRC.toFixed(1)}
              strokeDashoffset={(RING_CIRC * (1 - fraction)).toFixed(1)}
              transform="rotate(-90 21 21)"
            />
            <text x="21" y="25" textAnchor="middle">
              {percent}%
            </text>
          </svg>
          <div className="prog-meta">
            <b>
              {approved} of {total}
            </b>{" "}
            segments
            <br />
            approved on this page
          </div>
        </div>
      </div>

      <button
        className="focus-toggle"
        aria-pressed={focusMode}
        onClick={onToggleFocus}
        type="button"
      >
        <span className="sw" aria-hidden="true" />
        <span>
          <b>Focus mode</b>
          <br />
          show only what needs review
        </span>
      </button>

      <nav className="seglist" aria-label="Segment list">
        {segments.map((s) => {
          const lvl = levelOf(s);
          const done = s.status === "approved";
          return (
            <button
              key={s.id}
              type="button"
              className={
                "seg-item lvl-" + lvl + (done ? " done" : "") + (s.id === activeId ? " active" : "")
              }
              aria-current={s.id === activeId ? "true" : undefined}
              onClick={() => onSelect(s.id)}
            >
              <span className="cdot" aria-hidden="true" />
              <span className="si-text">{preview(s.en)}</span>
              <span className="si-score">{lvl === "sacred" ? "✦" : Math.round(s.confidence * 100)}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
