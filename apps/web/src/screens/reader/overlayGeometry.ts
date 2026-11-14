// Where to draw the reading highlight on the camera view: the current line, the current phrase
// and the pointed word, as polygons along each line's own baseline (so a tilted page gets a
// tilted highlight and a curled page's bowed line gets a bowed one), plus an underline under the
// word. Everything is normalised to the camera image (0-1). No canvas, no React.
//
// Phrase and word extents come from the OCR word boxes when there are any (they follow the real
// letter widths); otherwise from character counts.
import { type Page, type PageLine, phraseSpan, phraseStart, type ReaderPosition } from "@/reader";

export interface Pt {
  x: number;
  y: number;
}

/**
 * A band along a line: the points of its top edge left to right, then of its bottom edge right
 * to left. Every band of one kind has the same number of points, so it can ease between
 * positions. See `corners` for the four corners.
 */
export type Poly = readonly Pt[];

export interface Highlight {
  line: Poly | null;
  phrase: Poly | null;
  word: Poly | null;
  /** The word's underline: a thin strip just under the text, so it eases like the others. */
  underline: Poly | null;
}

export const NO_HIGHLIGHT: Highlight = { line: null, phrase: null, word: null, underline: null };

/** Share of the text height above the baseline (matches the OCR's baseline estimate). */
const ABOVE_BASELINE = 0.78;

/** Steps along each kind of band; more steps follow a bowed line more closely. */
const STEPS = { line: 8, phrase: 8, word: 4, underline: 4 } as const;

/** Breathing room around each highlight, as a share of the text height. */
const PAD = {
  line: { x: 0.9, y: 0.22 },
  phrase: { x: 0.34, y: 0.16 },
  word: { x: 0.14, y: 0.08 },
} as const;

interface Base {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Text height, normalised to the image height. */
  height: number;
  /** Sag below the chord at the middle (normalised to the image height); 0 for a straight line. */
  bow: number;
}

/** The line's baseline and text height; a plain box is treated as a level line. */
function baseOf(line: PageLine): Base | null {
  const b = line.baseline;
  if (b && (b.height ?? line.box?.h)) {
    return {
      x0: b.x0,
      y0: b.y0,
      x1: b.x1,
      y1: b.y1,
      height: b.height ?? line.box?.h ?? 0,
      bow: b.bow ?? 0,
    };
  }
  const box = line.box;
  if (!box) return null;
  const y = box.y + box.h * ABOVE_BASELINE;
  return { x0: box.x, y0: y, x1: box.x + box.w, y1: y, height: box.h, bow: 0 };
}

/** The line at `t` (0 = start, 1 = end): the chord plus the parabola through its bow. */
function curveAt(b: Base, t: number): Pt {
  return {
    x: b.x0 + (b.x1 - b.x0) * t,
    y: b.y0 + (b.y1 - b.y0) * t + b.bow * 4 * t * (1 - t),
  };
}

/** A band `up` above and `down` below the line, from `t0` to `t1`, in `steps` steps. */
function ribbon(b: Base, t0: number, t1: number, up: number, down: number, steps: number): Poly {
  const top: Pt[] = [];
  const bottom: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const c = curveAt(b, t0 + ((t1 - t0) * i) / steps);
    top.push({ x: c.x, y: c.y - up });
    bottom.push({ x: c.x, y: c.y + down });
  }
  return [...top, ...bottom.reverse()];
}

/** The four corners of a band: top-left, top-right, bottom-right, bottom-left. */
export function corners(poly: Poly): [Pt, Pt, Pt, Pt] {
  const n = poly.length / 2 - 1;
  const at = (i: number): Pt => poly[i] ?? { x: 0, y: 0 };
  return [at(0), at(n), at(n + 1), at(2 * n + 1)];
}

/**
 * The part of the line from `t0` to `t1` (0 = line start, 1 = line end, along its baseline),
 * grown by `pad`. `aspect` is image height / width, so the padding is the same in pixels
 * horizontally and vertically.
 */
function band(
  b: Base,
  t0: number,
  t1: number,
  pad: { x: number; y: number },
  aspect: number,
  steps: number,
): Poly {
  const dx = b.x1 - b.x0 || 1e-6;
  const padT = (pad.x * b.height * aspect) / Math.abs(dx);
  const up = b.height * (ABOVE_BASELINE + pad.y);
  const down = b.height * (1 - ABOVE_BASELINE + pad.y);
  return ribbon(b, t0 - padT, t1 + padT, up, down, steps);
}

/** A normalised x position -> where along the baseline it is (0-1). */
function along(b: Base, x: number): number {
  return (x - b.x0) / (b.x1 - b.x0 || 1e-6);
}

/** The span of the current phrase along the line, from its words' boxes when it has them. */
function phraseT(
  page: Page,
  lineIndex: number,
  phraseIndex: number,
  b: Base,
): [number, number] | null {
  const line = page.lines[lineIndex];
  const phrase = line?.phrases[phraseIndex];
  if (!line || !phrase) return null;
  if (line.words?.length) {
    const start = phraseStart(page, lineIndex, phraseIndex);
    const end = start + phrase.text.length;
    const inside = line.words.filter((w) => w.start >= start && w.end <= end);
    if (inside.length) {
      const left = Math.min(...inside.map((w) => w.box.x));
      const right = Math.max(...inside.map((w) => w.box.x + w.box.w));
      return [along(b, left), along(b, right)];
    }
  }
  return phraseSpan(page, { line: lineIndex, phrase: phraseIndex });
}

export function computeHighlight(page: Page, position: ReaderPosition, aspect: number): Highlight {
  const line = page.lines[position.line];
  const b = line && baseOf(line);
  if (!line || !b) return NO_HIGHLIGHT;

  const phrase = phraseT(page, position.line, position.phrase, b);
  const word = position.word !== undefined ? line.words?.[position.word] : undefined;
  const wordT: [number, number] | null = word
    ? [along(b, word.box.x), along(b, word.box.x + word.box.w)]
    : null;

  // The underline: from just under the baseline, a strip about a tenth of the text height thick.
  const underline = wordT
    ? ribbon(b, wordT[0], wordT[1], -b.height * 0.16, b.height * 0.27, STEPS.underline)
    : null;

  return {
    line: band(b, 0, 1, PAD.line, aspect, STEPS.line),
    phrase: phrase ? band(b, phrase[0], phrase[1], PAD.phrase, aspect, STEPS.phrase) : null,
    word: wordT ? band(b, wordT[0], wordT[1], PAD.word, aspect, STEPS.word) : null,
    underline,
  };
}

/** Bands move toward their targets by `k` (0-1). A band that appears starts at its target. */
export function easePoly(from: Poly | null, to: Poly | null, k: number): Poly | null {
  if (!to) return null;
  if (!from || from.length !== to.length) return to;
  return to.map((c, i) => {
    const a = from[i] ?? c;
    return { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k };
  });
}

/** The largest point distance between two bands (normalised): how far one still has to go. */
export function polyGap(a: Poly | null, b: Poly | null): number {
  if (!a || !b) return a === b ? 0 : 1;
  if (a.length !== b.length) return 1;
  return Math.max(...a.map((p, i) => Math.hypot(p.x - (b[i]?.x ?? 0), p.y - (b[i]?.y ?? 0))));
}
