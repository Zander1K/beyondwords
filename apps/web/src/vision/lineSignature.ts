// A fingerprint of a line's pixels, to tell whether a line seen again is the same line with the
// same words (so its last reading can be reused) or has changed (a hand over it, the page
// turned). Reading a spread costs ~70 line recognitions; most lines do not change between
// frames, so only the changed ones are read again.
//
// The fingerprint is the ink density along the line: the average brightness of 32 cells along
// its curve, standardised so lighting and exposure drop out. Each cell averages 80 samples:
// glyph strokes are ~4 px apart, so with fewer samples a 3 px shake swaps strokes for paper in
// them and the same line looks different (15 samples per cell: the same line, with noise and up
// to 4 px of shake, had a median distance of 0.89, as far as different lines at 1.1).
//
// Calibrated on photos of the demo book (noise and up to 4 px shake against every other line):
//   same line: median 0.29-0.38, 95th percentile 0.52-0.78 (blurred, low-contrast lines are worst)
//   different lines: median ~1.0, the nearest 0.30, 1st percentile 0.40-0.52
// so it is a good filter, not an oracle: the worker also re-reads everything every few frames and
// always re-reads lines it was unsure of.
// Pure functions on RGBA pixels; no browser APIs.
import { type TextLine } from "./lineFinder";
import { onLine, textHeight } from "./strips";

export const SIGNATURE_TUNING = {
  /** Cells along the line. */
  cells: 32,
  /** Samples per cell: along the line x across it. */
  along: 10,
  across: 8,
  /** The samples across span this much of the text height around the line's middle. */
  span: 0.6,
} as const;

/** Brightness of the pixel at (x, y), 0-255 (the nearest pixel; outside the frame reads 0). */
function luma(rgba: Uint8ClampedArray, w: number, h: number, x: number, y: number): number {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= w || yi >= h) return 0;
  const i = (yi * w + xi) * 4;
  return ((rgba[i] ?? 0) * 77 + (rgba[i + 1] ?? 0) * 150 + (rgba[i + 2] ?? 0) * 29) >> 8;
}

/** The fingerprint of `line` in an RGBA image of `w` x `h` pixels. */
export function lineSignature(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  line: TextLine,
): Float32Array {
  const { cells, along, across, span } = SIGNATURE_TUNING;
  const sig = new Float32Array(cells);
  for (let c = 0; c < cells; c++) {
    let sum = 0;
    for (let a = 0; a < along; a++) {
      const s = (line.length * (c + (a + 0.5) / along)) / cells;
      for (let k = 0; k < across; k++) {
        const t = -span / 2 + (span * (k + 0.5)) / across;
        const p = onLine(line, s, t);
        sum += luma(rgba, w, h, p.x, p.y);
      }
    }
    sig[c] = sum / (along * across);
  }
  // Standardise: the same line looks the same in bright and dim light.
  let mean = 0;
  for (const v of sig) mean += v;
  mean /= cells;
  let variance = 0;
  for (const v of sig) variance += (v - mean) ** 2;
  const sd = Math.sqrt(variance / cells) || 1;
  for (let c = 0; c < cells; c++) sig[c] = ((sig[c] ?? 0) - mean) / sd;
  return sig;
}

/** How different two fingerprints are: the mean absolute difference (0 = identical). */
export function signatureDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return n ? sum / n : Number.POSITIVE_INFINITY;
}

/** What is remembered of a line from the last frame. */
export interface RememberedLine {
  line: TextLine;
  signature: Float32Array;
  text: string;
  confidence: number;
}

export const MATCH_TUNING = {
  /** The line's middle may have moved this far (x text height) and still be the same line. */
  move: 0.6,
  /** Its length may differ by this share. */
  length: 0.12,
  /**
   * Fingerprints this close (mean absolute difference) are the same words. Reuses ~3 in 4
   * unchanged lines; ~1-2% of unrelated pairs of lines fall under it (see the calibration above).
   */
  distance: 0.45,
} as const;

function middle(line: TextLine): { x: number; y: number } {
  const p = line.points[Math.floor(line.points.length / 2)];
  return { x: p?.x ?? 0, y: p?.y ?? 0 };
}

/**
 * Which remembered line (index) is this line again, with the same words; -1 if none. The nearest
 * remembered line whose middle, length and fingerprint all agree. `taken` lines are skipped, so
 * two lines never reuse one reading.
 */
export function matchLine(
  remembered: readonly RememberedLine[],
  line: TextLine,
  signature: Float32Array,
  taken: ReadonlySet<number> = new Set(),
): number {
  const here = middle(line);
  const th = textHeight(line);
  let best = -1;
  let bestDistance: number = MATCH_TUNING.distance;
  remembered.forEach((r, i) => {
    if (taken.has(i)) return;
    const there = middle(r.line);
    if (Math.hypot(there.x - here.x, there.y - here.y) > MATCH_TUNING.move * th) return;
    if (
      Math.abs(r.line.length - line.length) >
      MATCH_TUNING.length * Math.max(r.line.length, line.length)
    )
      return;
    const d = signatureDistance(r.signature, signature);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}
