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

/** Same line in two reads: overlapping vertically (half the smaller height) and horizontally. */
function sameLine(a: Box, b: Box): boolean {
  const vertical = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const horizontal = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  return vertical >= 0.5 * Math.min(a.h, b.h) && horizontal > 0;
}

/** Vertical overlap of two boxes (0 if apart). */
function verticalOverlap(a: Box, b: Box): number {
  return Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
}

/** The line in `lines` that is the same line as `box`, overlapping it most. */
function bestMatch(lines: PageLine[], box: Box): PageLine | undefined {
  let best: PageLine | undefined;
  let bestOverlap = 0;
  for (const l of lines) {
    if (!l.box || !sameLine(l.box, box)) continue;
    const overlap = verticalOverlap(l.box, box);
    if (overlap > bestOverlap) {
      best = l;
      bestOverlap = overlap;
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
    const nBox = n.box;
    if (!nBox) return n;
    const old = bestMatch(prev.lines.filter(underHand), nBox);
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
    const box = line.box;
    if (next.lines.some((n) => n.box && sameLine(n.box, box))) continue;
    kept.push(line); // hidden under the hand in this read: keep its last reading
  }
  const lines = [...fromRead, ...kept].sort((a, b) => (a.box?.y ?? 0) - (b.box?.y ?? 0));
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
