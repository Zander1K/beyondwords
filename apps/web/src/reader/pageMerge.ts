// Continuous scanning: each new read of the camera frame is merged into the page we already
// have, instead of replacing it.
//   - Lines the hand covers are missing or cut into fragments in a new read; keep their last
//     (longer) reading.
//   - A big change in the text means the page was turned: start a new page.
//   - The reading position follows its line even if line indices shift between reads.
// No React, no browser APIs.
import type { Box, Page, PageLine } from "./page";
import type { ReaderPosition } from "./readerMachine";

/** Below this word overlap a read is treated as a different page. [ASSUMPTION] */
export const NEW_PAGE_BELOW_SIMILARITY = 0.35;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

/** Share of `b`'s words also found in `a` (multiset), 0-1. */
export function textSimilarity(a: string, b: string): number {
  const pool = words(a);
  const target = words(b);
  if (!target.length) return 0;
  let hit = 0;
  for (const w of target) {
    const i = pool.indexOf(w);
    if (i >= 0) {
      hit += 1;
      pool.splice(i, 1);
    }
  }
  return hit / target.length;
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Where a line's baseline is at horizontal position `x` (normalised). */
function baselineAt(b: NonNullable<PageLine["baseline"]>, x: number): number {
  return b.x1 === b.x0 ? b.y0 : b.y0 + ((b.y1 - b.y0) * (x - b.x0)) / (b.x1 - b.x0);
}

/**
 * Reading order: page by page (left first), then top to bottom, comparing a page's baselines at
 * one x (the page's middle) so lines of different lengths on a tilted page stay in order.
 */
function readingOrder(lines: PageLine[]): PageLine[] {
  const middles = new Map<number, number>();
  for (const block of new Set(lines.map((l) => l.block ?? 0))) {
    const xs = lines
      .filter((l) => (l.block ?? 0) === block && l.baseline)
      .flatMap((l) => (l.baseline ? [l.baseline.x0, l.baseline.x1] : []));
    middles.set(block, xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0.5);
  }
  const y = (l: PageLine) =>
    l.baseline ? baselineAt(l.baseline, middles.get(l.block ?? 0) ?? 0.5) : (l.box?.y ?? 0);
  return [...lines].sort((a, b) => (a.block ?? 0) - (b.block ?? 0) || y(a) - y(b));
}

/**
 * How far apart two lines are vertically, as a fraction of their text height (0 = same place),
 * or null if they do not overlap horizontally. Uses baselines when both have them: on a tilted
 * page the boxes of neighbouring lines overlap, their baselines do not.
 */
function lineDistance(a: PageLine, b: PageLine): number | null {
  if (!a.box || !b.box) return null;
  const from = Math.max(a.box.x, b.box.x);
  const to = Math.min(a.box.x + a.box.w, b.box.x + b.box.w);
  if (to <= from) return null;
  const ab = a.baseline;
  const bb = b.baseline;
  if (ab?.height && bb?.height) {
    const mid = (from + to) / 2;
    return Math.abs(baselineAt(ab, mid) - baselineAt(bb, mid)) / Math.min(ab.height, bb.height);
  }
  const overlap = Math.min(a.box.y + a.box.h, b.box.y + b.box.h) - Math.max(a.box.y, b.box.y);
  return 1 - overlap / Math.min(a.box.h, b.box.h);
}

/** Same line in two reads: within half a line height of each other, overlapping horizontally. */
function sameLine(a: PageLine, b: PageLine): boolean {
  const d = lineDistance(a, b);
  return d !== null && d <= 0.5;
}

/** The line in `lines` that is the same line as `line`, closest to it. */
function bestMatch(lines: PageLine[], line: PageLine): PageLine | undefined {
  let best: PageLine | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const l of lines) {
    const d = lineDistance(l, line);
    if (d === null || d > 0.5) continue;
    if (d < bestDistance) {
      best = l;
      bestDistance = d;
    }
  }
  return best;
}

export interface MergeResult {
  page: Page;
  /** The text changed enough to count as a new page (page turned, new book). */
  newPage: boolean;
}

/**
 * Merge a fresh read into the current page. `occluded` is where hands are in the frame
 * (normalised), or null.
 */
export function mergePages(
  prev: Page,
  next: Page,
  occluded: Box | null,
  demo = false,
): MergeResult {
  if (!next.lines.length) return { page: prev, newPage: false };
  const prevText = prev.lines.map((l) => l.text).join(" ");
  const nextText = next.lines.map((l) => l.text).join(" ");
  const fresh = demo || !prev.lines.some((l) => l.box);
  if (fresh || textSimilarity(prevText, nextText) < NEW_PAGE_BELOW_SIMILARITY) {
    return { page: next, newPage: true };
  }

  // Under the hand, a line is either missing from the new read or cut into fragments. Keep the
  // remembered reading in both cases; elsewhere the fresh read wins.
  const underHand = (l: PageLine) => Boolean(occluded && l.box && intersects(l.box, occluded));
  // A hand-cut line has fewer letters (OCR may still split it into as many "words").
  const letters = (l: PageLine) => (l.text.match(/\p{L}/gu) ?? []).length;
  const usedPrev = new Set<PageLine>();
  const fromRead: PageLine[] = next.lines.map((n) => {
    if (!n.box) return n;
    const old = bestMatch(prev.lines.filter(underHand), n);
    if (old && letters(old) > letters(n)) {
      usedPrev.add(old);
      return old;
    }
    if (old) usedPrev.add(old);
    return n;
  });
  const kept: PageLine[] = [];
  for (const line of prev.lines) {
    if (usedPrev.has(line) || !line.box || !underHand(line)) continue;
    if (next.lines.some((n) => sameLine(n, line))) continue;
    kept.push(line); // hidden under the hand in this read: keep its last reading
  }
  const lines = readingOrder([...fromRead, ...kept]);
  return { page: { id: prev.id, lines }, newPage: false };
}

/**
 * Where the reader should be on the updated page: the line with the most similar text to the
 * current one, same phrase index if it still exists. The pointed word is dropped (the next
 * fingertip frame picks it again).
 */
export function mapPosition(prev: Page, next: Page, position: ReaderPosition): ReaderPosition {
  const current = prev.lines[position.line];
  if (!current) return { line: 0, phrase: 0 };
  let best = -1;
  let bestScore = 0;
  next.lines.forEach((l, i) => {
    const score = textSimilarity(l.text, current.text);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  if (best < 0)
    return { line: Math.min(position.line, Math.max(0, next.lines.length - 1)), phrase: 0 };
  const phrases = next.lines[best]?.phrases.length ?? 1;
  return { line: best, phrase: Math.min(position.phrase, Math.max(0, phrases - 1)) };
}
