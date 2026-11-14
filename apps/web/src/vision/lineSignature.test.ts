import { describe, expect, it } from "vitest";

import type { TextLine } from "./lineFinder";
import {
  lineSignature,
  matchLine,
  MATCH_TUNING,
  type RememberedLine,
  signatureDistance,
} from "./lineSignature";

const W = 600;
const H = 200;

/** A straight line from (x0, y) to (x1, y), 10 px thick (so 20 px of text). */
function lineAt(x0: number, x1: number, y: number): TextLine {
  const n = 9;
  const points = Array.from({ length: n }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / (n - 1), y }));
  const length = x1 - x0;
  return {
    points,
    arc: points.map((_, i) => (length * i) / (n - 1)),
    length,
    thickness: 10,
    core: { left: x0, right: x1 },
  };
}

/**
 * An image of "text": dark word-like blocks on paper along y = 100, at the given x positions
 * (start, width pairs), with optional per-pixel noise.
 */
function image(words: [number, number][], noise = 0, seed = 1): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4).fill(235);
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  for (const [x0, w] of words) {
    for (let y = 92; y < 108; y++) {
      for (let x = x0; x < x0 + w; x++) {
        // Strokes: dark and light in a pattern, like letters, not a solid bar.
        if ((x + y) % 5 < 3) px.set([40, 40, 40], (y * W + x) * 4);
      }
    }
  }
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  if (noise) {
    for (let i = 0; i < px.length; i += 4) {
      const n = (rnd() + rnd() + rnd() - 1.5) * noise;
      px[i] = (px[i] ?? 0) + n;
      px[i + 1] = (px[i + 1] ?? 0) + n;
      px[i + 2] = (px[i + 2] ?? 0) + n;
    }
  }
  return px;
}

const SENTENCE_A: [number, number][] = [
  [30, 60],
  [110, 90],
  [220, 40],
  [280, 120],
  [420, 70],
  [510, 50],
];
const SENTENCE_B: [number, number][] = [
  [30, 110],
  [160, 50],
  [230, 30],
  [280, 60],
  [360, 130],
  [510, 50],
];

describe("lineSignature", () => {
  const line = lineAt(20, 560, 100);

  it("is the same for the same line seen again with noise", () => {
    const a = lineSignature(image(SENTENCE_A), W, H, line);
    const b = lineSignature(image(SENTENCE_A, 20, 7), W, H, line);
    expect(signatureDistance(a, b)).toBeLessThan(MATCH_TUNING.distance / 2);
  });

  it("survives the line moving a few pixels along it", () => {
    const a = lineSignature(image(SENTENCE_A), W, H, line);
    const moved = lineSignature(image(SENTENCE_A), W, H, lineAt(23, 563, 101));
    expect(signatureDistance(a, moved)).toBeLessThan(MATCH_TUNING.distance);
  });

  it("is too far from the fingerprint of different words in the same place to match", () => {
    const a = lineSignature(image(SENTENCE_A), W, H, line);
    const b = lineSignature(image(SENTENCE_B), W, H, line);
    expect(signatureDistance(a, b)).toBeGreaterThan(MATCH_TUNING.distance);
  });

  it("does not change with the light: brighter and dimmer frames match", () => {
    const base = image(SENTENCE_A);
    const dim = base.map((v, i) => (i % 4 === 3 ? v : v * 0.5));
    const a = lineSignature(base, W, H, line);
    const b = lineSignature(dim, W, H, line);
    expect(signatureDistance(a, b)).toBeLessThan(0.05);
  });

  it("changes when a hand covers part of the line", () => {
    const clean = image(SENTENCE_A);
    const covered = new Uint8ClampedArray(clean);
    for (let y = 80; y < 130; y++) {
      for (let x = 250; x < 400; x++) covered.set([90, 60, 45], (y * W + x) * 4);
    }
    const a = lineSignature(clean, W, H, line);
    const b = lineSignature(covered, W, H, line);
    expect(signatureDistance(a, b)).toBeGreaterThan(MATCH_TUNING.distance);
  });
});

describe("matchLine", () => {
  const pixels = image(SENTENCE_A);
  const other = image(SENTENCE_B);
  const line = lineAt(20, 560, 100);
  const remember = (l: TextLine, px: Uint8ClampedArray): RememberedLine => ({
    line: l,
    signature: lineSignature(px, W, H, l),
    text: "words",
    confidence: 0.98,
  });

  it("finds the same line again, and not a different one in the same place", () => {
    const remembered = [remember(line, pixels)];
    expect(matchLine(remembered, line, lineSignature(pixels, W, H, line))).toBe(0);
    expect(matchLine(remembered, line, lineSignature(other, W, H, line))).toBe(-1);
  });

  it("will not match a line that has moved more than a fraction of a line, or changed length", () => {
    const remembered = [remember(line, pixels)];
    const moved = lineAt(20, 560, 100 + 20 * MATCH_TUNING.move * 2); // text height 20
    expect(matchLine(remembered, moved, lineSignature(pixels, W, H, line))).toBe(-1);
    const longer = lineAt(20, 20 + 540 * 1.3, 100);
    expect(matchLine(remembered, longer, lineSignature(pixels, W, H, line))).toBe(-1);
  });

  it("never gives one reading to two lines", () => {
    const remembered = [remember(line, pixels)];
    const sig = lineSignature(pixels, W, H, line);
    const taken = new Set<number>();
    const first = matchLine(remembered, line, sig, taken);
    taken.add(first);
    expect(matchLine(remembered, line, sig, taken)).toBe(-1);
  });

  it("picks the nearest of several lines that agree", () => {
    const a = lineAt(20, 560, 100);
    const b = lineAt(20, 560, 108);
    const remembered = [remember(a, pixels), remember(b, pixels)];
    const here = lineAt(20, 560, 107);
    expect(matchLine(remembered, here, lineSignature(pixels, W, H, here))).toBeGreaterThanOrEqual(
      0,
    );
  });
});
