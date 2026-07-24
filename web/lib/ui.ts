// Pure UI helpers: confidence -> level, percent formatting, tracked-changes
// word diff, and footnote anchor parsing. No React, easy to reason about/test.

import type { Segment } from "./types";

export type Level = "high" | "med" | "low" | "sacred";

export function levelOf(seg: Segment): Level {
  if (seg.kind === "sacred") return "sacred";
  if (seg.confidence >= 0.85) return "high";
  if (seg.confidence >= 0.75) return "med";
  return "low";
}

export function pct(v: number | null | undefined): number {
  if (v == null) return 0;
  return Math.round(v * 100);
}

export function confTag(seg: Segment): string {
  if (seg.kind === "sacred") return "canonical · locked";
  const p = pct(seg.confidence);
  if (p >= 85) return "high confidence";
  if (p >= 75) return "review suggested";
  return "needs review";
}

// One-line preview for the rail (tags stripped, truncated).
export function preview(en: string, max = 46): string {
  const t = stripAnchors(en).trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// Remove [[FN-n]] anchors for plain-text contexts.
export function stripAnchors(s: string): string {
  return s.replace(/\[\[FN-\d+\]\]/g, "");
}

// Split body text into text runs and footnote-anchor markers.
export type BodyToken =
  | { type: "text"; value: string }
  | { type: "fn"; anchor: string; n: string };

export function tokenizeBody(en: string): BodyToken[] {
  const out: BodyToken[] = [];
  const re = /\[\[FN-(\d+)\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(en)) !== null) {
    if (m.index > last) out.push({ type: "text", value: en.slice(last, m.index) });
    out.push({ type: "fn", anchor: `FN-${m[1]}`, n: m[1] });
    last = re.lastIndex;
  }
  if (last < en.length) out.push({ type: "text", value: en.slice(last) });
  return out;
}

// ---- word-level tracked-changes diff (LCS) ----
export type DiffToken =
  | { type: "equal"; value: string }
  | { type: "ins"; value: string }
  | { type: "del"; value: string };

function splitWords(s: string): string[] {
  // Keep separators so spacing/punctuation are preserved.
  return s.split(/(\s+)/).filter((t) => t.length > 0);
}

export function diffWords(before: string, after: string): DiffToken[] {
  const a = splitWords(before);
  const b = splitWords(after);
  const n = a.length;
  const m = b.length;
  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffToken[] = [];
  let i = 0;
  let j = 0;
  const push = (type: DiffToken["type"], value: string) => {
    const prev = out[out.length - 1];
    if (prev && prev.type === type) prev.value += value;
    else out.push({ type, value } as DiffToken);
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("equal", a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push("del", a[i]);
      i++;
    } else {
      push("ins", b[j]);
      j++;
    }
  }
  while (i < n) push("del", a[i++]);
  while (j < m) push("ins", b[j++]);
  return out;
}
