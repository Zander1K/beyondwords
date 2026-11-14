// Nearest-line picking (SIM-VIS-03): the line the fingertip is UNDER (a reader points just
// below the words), with hysteresis so the highlight does not flicker between lines; then the
// exact word above the fingertip on that line, and the phrase containing it.
//
// Uses each line's OCR baseline, not its box: on a tilted page the boxes of neighbouring lines
// overlap, the baselines do not.
// [ASSUMPTION] Thresholds are first guesses; tune on real footage (SIM-VIS-06, P1).
import { type Page, phraseAtOffset, phraseSpan, type ReaderPosition } from "@/reader";

import type { Point } from "./handPose";

export const PICK_THRESHOLDS = {
  /** Horizontal slack beyond the line's ends, as a fraction of the image. */
  xSlack: 0.04,
  /** How far above the baseline the tip may be and still count (fraction of line height). */
  aboveBaseline: 0.4,
  /** How far below the baseline the tip may be (fraction of line height). */
  belowBaseline: 2.2,
  /** A different line must be this much closer (fraction of line height) to take over... */
  switchMargin: 0.35,
  /** ...and win this many frames in a row. */
  confirmFrames: 3,
  /** Stay on the current phrase until the tip is this far into the next one (fraction of line). */
  phraseSlack: 0.03,
  /** Stay on the current word until the tip is this far past its edge (fraction of its width). */
  wordSlack: 0.2,
} as const;

export interface PickerState {
  position: ReaderPosition | null;
  candidate: number | null;
  candidateFrames: number;
}

export const initialPickerState: PickerState = {
  position: null,
  candidate: null,
  candidateFrames: 0,
};

interface Hit {
  line: number;
  /** Tip distance below the baseline, in image units (negative = above). */
  gap: number;
  height: number;
  /** Where along the line the tip is, 0-1. */
  along: number;
}

function hits(page: Page, tip: Point): Hit[] {
  const out: Hit[] = [];
  page.lines.forEach((line, i) => {
    const b = line.baseline;
    const height = line.box?.h ?? 0;
    if (!b || height <= 0) return;
    const left = Math.min(b.x0, b.x1);
    const right = Math.max(b.x0, b.x1);
    if (tip.x < left - PICK_THRESHOLDS.xSlack || tip.x > right + PICK_THRESHOLDS.xSlack) return;
    const along = Math.max(0, Math.min(1, (tip.x - b.x0) / (b.x1 - b.x0 || 1)));
    const gap = tip.y - (b.y0 + (b.y1 - b.y0) * along);
    if (gap < -PICK_THRESHOLDS.aboveBaseline * height) return;
    if (gap > PICK_THRESHOLDS.belowBaseline * height) return;
    out.push({ line: i, gap, height, along });
  });
  return out;
}

function phraseAt(page: Page, line: number, along: number, current: ReaderPosition | null): number {
  const count = page.lines[line]?.phrases.length ?? 0;
  if (current && current.line === line) {
    const span = phraseSpan(page, current);
    const slack = PICK_THRESHOLDS.phraseSlack;
    if (span && along >= span[0] - slack && along <= span[1] + slack) return current.phrase;
  }
  for (let p = 0; p < count; p++) {
    const span = phraseSpan(page, { line, phrase: p });
    if (span && along < span[1]) return p;
  }
  return Math.max(0, count - 1);
}

/**
 * The word above the fingertip on `line`: the word whose box spans the tip's x, else the
 * nearest one. Sticks to the current word until the tip is clearly past its edge.
 */
export function wordAt(
  page: Page,
  line: number,
  tipX: number,
  current: ReaderPosition | null,
): number | undefined {
  const words = page.lines[line]?.words;
  if (!words?.length) return undefined;
  if (current && current.line === line && current.word !== undefined) {
    const w = words[current.word];
    if (w) {
      const slack = w.box.w * PICK_THRESHOLDS.wordSlack;
      if (tipX >= w.box.x - slack && tipX <= w.box.x + w.box.w + slack) return current.word;
    }
  }
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  words.forEach((w, i) => {
    const distance =
      tipX < w.box.x ? w.box.x - tipX : tipX > w.box.x + w.box.w ? tipX - (w.box.x + w.box.w) : 0;
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}

/** Line + tip -> position (word and its phrase when words are known, else phrase by span). */
function positionAt(
  page: Page,
  line: number,
  tipX: number,
  along: number,
  current: ReaderPosition | null,
): ReaderPosition {
  const word = wordAt(page, line, tipX, current);
  const start = word !== undefined ? page.lines[line]?.words?.[word]?.start : undefined;
  if (word !== undefined && start !== undefined) {
    return { line, phrase: phraseAtOffset(page, line, start), word };
  }
  return { line, phrase: phraseAt(page, line, along, current) };
}

/**
 * One frame of picking. Returns the new state; `state.position` is the line and phrase under the
 * fingertip, or the last one held when the tip is not near any line.
 */
export function pickLine(page: Page, tip: Point, prev: PickerState): PickerState {
  const candidates = hits(page, tip);
  if (candidates.length === 0) return { ...prev, candidate: null, candidateFrames: 0 };

  // The nearest line above the fingertip; lines the tip is below come first.
  const best = candidates.reduce((a, b) => {
    const aBelow = a.gap >= 0;
    const bBelow = b.gap >= 0;
    if (aBelow !== bBelow) return aBelow ? a : b;
    return Math.abs(a.gap) <= Math.abs(b.gap) ? a : b;
  });

  const current = prev.position;
  const currentHit = current ? candidates.find((c) => c.line === current.line) : undefined;

  // Stay on the current line unless another one is clearly closer.
  if (
    currentHit &&
    (best.line === currentHit.line ||
      Math.abs(currentHit.gap) - Math.abs(best.gap) < PICK_THRESHOLDS.switchMargin * best.height)
  ) {
    return {
      position: positionAt(page, currentHit.line, tip.x, currentHit.along, current),
      candidate: null,
      candidateFrames: 0,
    };
  }

  // A new line must win several frames in a row (first pick is immediate).
  const frames = prev.candidate === best.line ? prev.candidateFrames + 1 : 1;
  if (current && frames < PICK_THRESHOLDS.confirmFrames) {
    return { ...prev, candidate: best.line, candidateFrames: frames };
  }
  return {
    position: positionAt(page, best.line, tip.x, best.along, null),
    candidate: null,
    candidateFrames: 0,
  };
}
