import { describe, expect, it } from "vitest";

import { findLines, pointAt, splitBlocks, type TextLine } from "./lineFinder";

const W = 400;
const H = 300;

/** A detector map with the given stripes: each from (x0, y0) to (x1, y1), `thick` px thick. */
function mapOf(
  stripes: { x0: number; y0: number; x1: number; y1: number; thick?: number; bow?: number }[],
): Float32Array {
  const map = new Float32Array(W * H);
  for (const s of stripes) {
    const thick = s.thick ?? 10;
    for (let x = s.x0; x <= s.x1; x++) {
      const f = (x - s.x0) / (s.x1 - s.x0);
      // A straight stripe, bowed by `bow` px at the middle.
      const cy = s.y0 + (s.y1 - s.y0) * f + (s.bow ?? 0) * 4 * f * (1 - f);
      for (let y = Math.round(cy - thick / 2); y < Math.round(cy + thick / 2); y++) {
        if (y >= 0 && y < H) map[y * W + x] = 0.95;
      }
    }
  }
  return map;
}

describe("findLines", () => {
  it("finds each stripe as its own line, however it slopes", () => {
    const map = mapOf([
      { x0: 20, y0: 40, x1: 180, y1: 40 },
      { x0: 20, y0: 70, x1: 180, y1: 85 }, // slopes down
      { x0: 20, y0: 120, x1: 180, y1: 100 }, // slopes up
    ]);
    const lines = findLines(map, W, H);
    expect(lines).toHaveLength(3);
    const byTop = [...lines].sort((a, b) => (a.points[0]?.y ?? 0) - (b.points[0]?.y ?? 0));
    const slope = (l: TextLine) => {
      const p = l.points[0];
      const q = l.points[l.points.length - 1];
      return ((q?.y ?? 0) - (p?.y ?? 0)) / ((q?.x ?? 1) - (p?.x ?? 0));
    };
    expect(slope(byTop[0] as TextLine)).toBeCloseTo(0, 1);
    expect(slope(byTop[1] as TextLine)).toBeCloseTo(15 / 160, 1);
    expect(slope(byTop[2] as TextLine)).toBeCloseTo(-20 / 160, 1);
  });

  it("measures thickness and length, and extends the ends past the stripe", () => {
    const [line] = findLines(mapOf([{ x0: 50, y0: 100, x1: 250, y1: 100, thick: 14 }]), W, H);
    if (!line) throw new Error("expected a line");
    expect(line.thickness).toBeGreaterThanOrEqual(13);
    expect(line.thickness).toBeLessThanOrEqual(15);
    // 200 px stripe plus 1.5 x thickness at each end.
    expect(line.length).toBeGreaterThan(200 + 14 * 2);
    expect(line.core.left).toBeCloseTo(50, -1);
    expect(line.core.right).toBeCloseTo(250, -1);
    expect(line.points[0]?.x ?? 99).toBeLessThan(line.core.left);
  });

  it("follows a line that bows (a curled page)", () => {
    const [line] = findLines(mapOf([{ x0: 20, y0: 100, x1: 220, y1: 100, bow: 16 }]), W, H);
    if (!line) throw new Error("expected a line");
    const mid = line.points[Math.floor(line.points.length / 2)];
    // The middle of the curve sits 16 px below the ends.
    expect(mid?.y ?? 0).toBeCloseTo(116, -1);
    expect(line.points[0]?.y ?? 0).toBeLessThan((mid?.y ?? 0) - 8);
  });

  it("scales results to frame pixels", () => {
    const [line] = findLines(mapOf([{ x0: 50, y0: 100, x1: 250, y1: 100 }]), W, H, 2);
    expect(line?.core.left).toBeCloseTo(100, -1);
    expect(line?.thickness).toBeCloseTo(20, -1);
  });

  it("ignores specks, thin noise and upright strokes", () => {
    const map = mapOf([{ x0: 100, y0: 50, x1: 106, y1: 50, thick: 6 }]); // a speck
    for (let y = 60; y < 200; y++) for (let x = 300; x < 306; x++) map[y * W + x] = 0.95; // upright
    expect(findLines(map, W, H)).toEqual([]);
  });

  it("leaves a faint smear below the threshold alone", () => {
    const map = mapOf([{ x0: 20, y0: 60, x1: 200, y1: 60 }]);
    for (let i = 0; i < map.length; i++) if (map[i]) map[i] = 0.2;
    expect(findLines(map, W, H)).toEqual([]);
  });
});

describe("pointAt", () => {
  it("walks along the curve by arc length, with the angle there", () => {
    const [line] = findLines(mapOf([{ x0: 20, y0: 100, x1: 220, y1: 130 }]), W, H);
    if (!line) throw new Error("expected a line");
    const start = pointAt(line, 0);
    const end = pointAt(line, line.length);
    expect(end.x).toBeGreaterThan(start.x + 150);
    expect(end.y).toBeGreaterThan(start.y + 20);
    expect(start.angle).toBeCloseTo(Math.atan2(30, 200), 1);
    // Past the ends it keeps going straight rather than failing.
    expect(pointAt(line, line.length + 50).x).toBeGreaterThan(end.x);
  });
});

describe("splitBlocks", () => {
  /** Lines in two pages with a gap between them. */
  function pages(gap: boolean): TextLine[] {
    const stripes = [];
    for (let i = 0; i < 6; i++) {
      stripes.push({ x0: 20, y0: 30 + i * 30, x1: gap ? 180 : 218, y1: 30 + i * 30 });
      stripes.push({ x0: 220, y0: 30 + i * 30, x1: 380, y1: 30 + i * 30 });
    }
    return findLines(mapOf(stripes), W, H);
  }

  it("splits an open book at the gap between its pages", () => {
    const lines = pages(true);
    const split = splitBlocks(lines, W);
    expect(split.gutter).toBeGreaterThan(180);
    expect(split.gutter).toBeLessThan(220);
    for (let i = 0; i < lines.length; i++) {
      const left = (lines[i]?.core.left ?? 0) < 100;
      expect(split.block[i]).toBe(left ? 0 : 1);
    }
  });

  it("finds no gutter when the lines run on across the frame", () => {
    const stripes = Array.from({ length: 8 }, (_, i) => ({
      x0: 20,
      y0: 30 + i * 30,
      x1: 380,
      y1: 30 + i * 30,
    }));
    const split = splitBlocks(findLines(mapOf(stripes), W, H), W);
    expect(split.gutter).toBeNull();
    expect(new Set(split.block)).toEqual(new Set([0]));
  });

  it("finds no gutter when the gap is too narrow, or a side has too few lines", () => {
    expect(splitBlocks(pages(false), W).gutter).toBeNull(); // 2 px gap in 400 (0.5%)
    const few = findLines(
      mapOf([
        { x0: 20, y0: 40, x1: 150, y1: 40 },
        { x0: 20, y0: 70, x1: 150, y1: 70 },
        { x0: 250, y0: 40, x1: 380, y1: 40 },
      ]),
      W,
      H,
    );
    expect(splitBlocks(few, W).gutter).toBeNull();
  });

  it("uses the stripe's own extent, not the extended ends, so a narrow gutter still splits", () => {
    // 40 px gap: the ends extend 1.5 x 10 px = 15 px each way and would nearly close it.
    const lines = pages(true);
    expect(splitBlocks(lines, W).gutter).not.toBeNull();
  });
});
