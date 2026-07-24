"use client";

import type { Segment } from "@/lib/types";
import { confTag, levelOf, pct } from "@/lib/ui";

const DIMS = ["Adequacy", "Fluency", "Terminology", "Footnotes"] as const;
const MQM_TAGS = ["Terminology", "Omission", "Addition", "Register", "Grammar", "Footnote"] as const;

export type Scores = Record<(typeof DIMS)[number], number>;

function fmt(v: number | null): string {
  return v == null ? "—" : v.toFixed(2);
}

export function ContextPanel({
  seg,
  page,
  scores,
  onScore,
  mqm,
  onToggleMqm,
  onApplyAlt,
  onTeachTerm,
  onTeachStyle,
}: {
  seg: Segment;
  page: number;
  scores: Scores;
  onScore: (dim: (typeof DIMS)[number], v: number) => void;
  mqm: string[];
  onToggleMqm: (tag: string) => void;
  onApplyAlt: (text: string) => void;
  onTeachTerm: () => void;
  onTeachStyle: () => void;
}) {
  const lvl = levelOf(seg);
  const sacred = seg.kind === "sacred";
  const ref = sacred ? "Qurʾān · al-Ḥadīd 57:3" : "";

  return (
    <aside className={"context lvl-" + lvl} aria-label="Segment detail">
      {/* Arabic source */}
      <div className="ctx-sec">
        <div className="ctx-label">
          Arabic source
          {ref && <span className="plain">{ref}</span>}
        </div>
        <div className={"arabic" + (sacred ? " sacred" : "")} dir="rtl" lang="ar">
          {seg.ar}
        </div>
      </div>

      {/* Source scan */}
      <div className="ctx-sec">
        <div className="ctx-label">Source scan · page {page}</div>
        <div className="scan">
          <div className="live" dir="rtl" lang="ar">
            {seg.ar}
          </div>
          <div className="bars">
            <i style={{ width: "92%" }} />
            <i style={{ width: "78%" }} />
            <i style={{ width: "85%" }} />
          </div>
          <div className="divider" />
          <div className="bars" style={{ opacity: 0.6 }}>
            <i style={{ width: "40%" }} />
            <i style={{ width: "52%" }} />
          </div>
          <div className="cap">
            <span>Header cropped · footnote split ✓</span>
            <span>300 dpi</span>
          </div>
        </div>
      </div>

      {/* Insights */}
      <div className="ctx-sec">
        <div className="ctx-label">Why this was flagged</div>
        <div className="conf-row">
          <span className="conf-num">{sacred ? "✦" : pct(seg.confidence) + "%"}</span>
          <span className="conf-tag">{confTag(seg)}</span>
        </div>
        <div className="confbar">
          <i style={{ width: (sacred ? 100 : pct(seg.confidence)) + "%" }} />
        </div>
        <div className="metric">
          <span>Back-translation similarity</span>
          <b>{fmt(seg.qa.bt_sim)}</b>
        </div>
        <div className="metric">
          <span>Self-consistency (2 samples)</span>
          <b>{fmt(seg.qa.self_consistency)}</b>
        </div>
        <div className="metric">
          <span>Routed engine</span>
          <b>{seg.engine}</b>
        </div>
        {seg.qa.judge_note && (
          <div className="judge" dir="auto">
            {seg.qa.judge_note}
          </div>
        )}
        {seg.alternatives.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="ctx-label">Alternatives</div>
            <div className="alts">
              {seg.alternatives.map((a, i) => (
                <button className="alt" key={i} type="button" onClick={() => onApplyAlt(a)}>
                  <span>{a}</span>
                  <span className="apply">apply →</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Quality score */}
      <div className="ctx-sec">
        <div className="ctx-label">
          Your quality score <span className="plain">feeds learning</span>
        </div>
        <div className="score-grid">
          {DIMS.map((d) => (
            <div className="score-row" key={d}>
              <span>{d}</span>
              <div className="dots" role="radiogroup" aria-label={d}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <button
                    key={i}
                    type="button"
                    className={i <= scores[d] ? "on" : ""}
                    aria-label={`${d} ${i} of 5`}
                    aria-pressed={i <= scores[d]}
                    onClick={() => onScore(d, i)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="ctx-label" style={{ marginTop: 16 }}>
          Flag issues (MQM)
        </div>
        <div className="tags">
          {MQM_TAGS.map((t) => (
            <button
              key={t}
              type="button"
              className={"tagchip" + (mqm.includes(t) ? " on" : "")}
              aria-pressed={mqm.includes(t)}
              onClick={() => onToggleMqm(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Teach the model */}
      <div className="ctx-sec" style={{ borderBottom: "none" }}>
        <div className="ctx-label">Teach the model</div>
        <div className="teach">
          <button type="button" onClick={onTeachTerm}>
            <span className="ic" aria-hidden="true">
              📖
            </span>
            <span>
              <b>Add to termbase</b>
              <small>
                <span className="ar" dir="rtl">
                  المتكلّمون
                </span>{" "}
                → “the mutakallimūn” · enforce everywhere
              </small>
            </span>
          </button>
          <button type="button" onClick={onTeachStyle}>
            <span className="ic" aria-hidden="true">
              ✎
            </span>
            <span>
              <b>Save as style rule</b>
              <small>Prefer transliterated technical terms over loose glosses</small>
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
}
