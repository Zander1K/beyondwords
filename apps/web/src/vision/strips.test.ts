import { describe, expect, it } from "vitest";

import { findLines, type TextLine } from "./lineFinder";
import { onLine, planStrips, STRIP_TUNING, textHeight } from "./strips";

/** A straight line from (x0, y0) to (x1, y1), 20 px thick. */
function straight(x0: number, y0: number, x1: number, y1: number): TextLine {
  const n = 7;
  const points = Array.from({ length: n }, (_, i) => ({
    x: x0 + ((x1 - x0) * i) / (n - 1),
    y: y0 + ((y1 - y0) * i) / (n - 1),
  }));
  const length = Math.hypot(x1 - x0, y1 - y0);
  return {
    points,
    arc: points.map((_, i) => (length * i) / (n - 1)),
    length,
    thickness: 20,
    core: { left: x0, right: x1 },
  };
}

/** Apply a canvas transform [a b c d e f] to a point. */
const apply = (m: number[], x: number, y: number) => ({
  x: (m[0] ?? 0) * x + (m[2] ?? 0) * y + (m[4] ?? 0),
  y: (m[1] ?? 0) * x + (m[3] ?? 0) * y + (m[5] ?? 0),
});

describe("planStrips", () => {
  const { stripHeight, gap } = STRIP_TUNING;

  it("stacks every strip at the recogniser's height, with a gap between", () => {
    const plan = planStrips([straight(100, 100, 400, 100), straight(100, 200, 300, 200)]);
    expect(plan.strips.map((s) => s.box.height)).toEqual([stripHeight, stripHeight]);
    expect(plan.strips[1]?.box.y).toBe(stripHeight + gap);
    expect(plan.height).toBe(2 * (stripHeight + gap));
  });

  it("scales a strip to the height the recogniser reads at, whatever size the text is", () => {
    const line = straight(100, 100, 400, 100);
    const k = stripHeight / (textHeight(line) * STRIP_TUNING.margin);
    const [strip] = planStrips([line]).strips;
    expect(strip?.box.width).toBe(Math.ceil(line.length * k));
    // Text twice as big in the photo gives a strip no taller, and a proportionally narrower scale.
    const big = { ...line, thickness: 40 };
    expect(planStrips([big]).strips[0]?.box.height).toBe(stripHeight);
  });

  it("maps the line's centre curve onto the middle of its strip", () => {
    // Slopes down 100 px over 400 px: each segment is rotated level.
    const line = straight(100, 100, 500, 200);
    const [strip] = planStrips([line]).strips;
    if (!strip) throw new Error("expected a strip");
    for (const [i, seg] of strip.segments.entries()) {
      const p = line.points[i];
      const q = line.points[i + 1];
      if (!p || !q) continue;
      const a = apply(seg.matrix, p.x, p.y);
      const b = apply(seg.matrix, q.x, q.y);
      // Both ends land on the strip's middle line, a segment's length apart.
      expect(a.y).toBeCloseTo(strip.box.y + stripHeight / 2, 5);
      expect(b.y).toBeCloseTo(strip.box.y + stripHeight / 2, 5);
      expect(b.x - a.x).toBeCloseTo(seg.clip.w - 0.75, 5);
      // Pieces butt up against each other along the strip.
      expect(a.x).toBeCloseTo(seg.clip.x, 5);
    }
  });

  it("maps a point above the curve to the top half of the strip", () => {
    const line = straight(100, 100, 500, 100);
    const [strip] = planStrips([line]).strips;
    const seg = strip?.segments[0];
    if (!strip || !seg) throw new Error("expected a segment");
    const above = apply(seg.matrix, 120, 100 - 10);
    expect(above.y).toBeLessThan(strip.box.y + stripHeight / 2);
    expect(above.y).toBeGreaterThan(strip.box.y);
  });

  it("covers each piece's photo area, enough to draw it", () => {
    const [strip] = planStrips([straight(100, 100, 500, 160)]).strips;
    for (const seg of strip?.segments ?? []) {
      expect(seg.source.w).toBeGreaterThan(0);
      expect(seg.source.h).toBeGreaterThan(0);
    }
  });

  it("plans a curved line made from a detector map", () => {
    const W = 300;
    const map = new Float32Array(W * 100);
    for (let x = 20; x < 280; x++) {
      const f = (x - 20) / 260;
      const cy = 50 + 14 * 4 * f * (1 - f);
      for (let y = Math.round(cy - 6); y < Math.round(cy + 6); y++) map[y * W + x] = 0.95;
    }
    const lines = findLines(map, W, 100);
    const plan = planStrips(lines);
    expect(plan.strips).toHaveLength(1);
    expect(plan.strips[0]?.segments.length).toBeGreaterThan(8);
  });
});

describe("onLine", () => {
  it("walks along the line and out to its top and bottom edges", () => {
    const line = straight(100, 100, 500, 100);
    const th = textHeight(line);
    const mid = onLine(line, 200, 0);
    expect(mid.x).toBeCloseTo(300, 5);
    expect(mid.y).toBeCloseTo(100, 5);
    expect(onLine(line, 200, -0.5).y).toBeCloseTo(100 - th / 2, 5);
    expect(onLine(line, 200, 0.5).y).toBeCloseTo(100 + th / 2, 5);
  });

  it("offsets across a sloping line, not straight down", () => {
    const line = straight(100, 100, 500, 200);
    const top = onLine(line, 200, -0.5);
    const bottom = onLine(line, 200, 0.5);
    // The offset is perpendicular to the line: no change along it.
    const along = Math.atan2(100, 400);
    const dx = bottom.x - top.x;
    const dy = bottom.y - top.y;
    expect(dx * Math.cos(along) + dy * Math.sin(along)).toBeCloseTo(0, 5);
  });
});
