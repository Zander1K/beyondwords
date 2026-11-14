import { describe, expect, it } from "vitest";

import type { TextLine } from "./lineFinder";
import { charWidth, splitItem, type StripRead, stripReadsToLines } from "./ocr";

describe("splitItem", () => {
  const item = (text: string, x: number, width: number) => ({
    text,
    box: { x, y: 0, width, height: 40 },
    confidence: 0.97,
  });

  it("splits a line into words that fill it in order, wider words wider", () => {
    const words = splitItem(item("The old lighthouse", 100, 600));
    expect(words.map((w) => w.text)).toEqual(["The", "old", "lighthouse"]);
    expect(words[0]?.x).toBe(100);
    const last = words[2];
    expect((last?.x ?? 0) + (last?.w ?? 0)).toBeCloseTo(700, 5);
    expect(words[2]?.w ?? 0).toBeGreaterThan((words[1]?.w ?? 0) * 2);
  });

  it("gives narrow letters less room than wide ones", () => {
    expect(charWidth("i")).toBeLessThan(charWidth("e"));
    expect(charWidth("m")).toBeGreaterThan(charWidth("e"));
  });
});

/** A straight text line from (x0, y0) to (x1, y1) in a 1000 x 1000 frame, 20 px thick. */
function line(x0: number, y0: number, x1: number, y1: number, thickness = 20): TextLine {
  const n = 9;
  const points = Array.from({ length: n }, (_, i) => ({
    x: x0 + ((x1 - x0) * i) / (n - 1),
    y: y0 + ((y1 - y0) * i) / (n - 1),
  }));
  const length = Math.hypot(x1 - x0, y1 - y0);
  return {
    points,
    arc: points.map((_, i) => (length * i) / (n - 1)),
    length,
    thickness,
    core: { left: Math.min(x0, x1), right: Math.max(x0, x1) },
  };
}

const read = (l: TextLine, text: string, block = 0, confidence = 0.95): StripRead => ({
  line: l,
  text,
  confidence,
  block,
});

describe("stripReadsToLines", () => {
  it("places words and the baseline along a line that slopes", () => {
    // Rises 100 px over 600 px (about 9.5 degrees), like the right page of the demo book.
    const l = line(200, 500, 800, 400);
    const [out] = stripReadsToLines([read(l, "aaaa bbbb cccc")], 1000, 1000);
    if (!out) throw new Error("expected a line");
    expect(out.text).toBe("aaaa bbbb cccc");
    // The baseline runs along the curve, so it rises to the right.
    expect(out.baseline.y1).toBeLessThan(out.baseline.y0);
    expect(out.baseline.x0).toBeCloseTo(0.2, 1);
    expect(out.baseline.x1).toBeCloseTo(0.8, 1);
    // Words step up the slope: each starts to the right of and above the one before.
    const [a, b, c] = out.words;
    expect(b?.box.x ?? 0).toBeGreaterThan(a?.box.x ?? 1);
    expect(c?.box.y ?? 1).toBeLessThan(a?.box.y ?? 0);
    // Offsets into the line text match the words.
    expect(out.words.map((w) => out.text.slice(w.start, w.end))).toEqual(["aaaa", "bbbb", "cccc"]);
    // The text height is 2x the stripe thickness, as a share of the frame height.
    expect(out.baseline.height).toBeCloseTo(0.04, 6);
  });

  it("records how far a bowed line sags below its chord", () => {
    // A level chord whose curve dips 17 px (0.017 of the frame) at the middle.
    const base = line(200, 500, 800, 500);
    const bowed: TextLine = {
      ...base,
      points: base.points.map((p, i) => ({
        x: p.x,
        y: p.y + 17 * 4 * (i / (base.points.length - 1)) * (1 - i / (base.points.length - 1)),
      })),
    };
    const [out] = stripReadsToLines([read(bowed, "aaaa bbbb cccc")], 1000, 1000);
    expect(out?.baseline.bow).toBeCloseTo(0.017, 3);
    // A straight line has none.
    const [flat] = stripReadsToLines([read(base, "aaaa bbbb cccc")], 1000, 1000);
    expect(flat?.baseline.bow ?? 1).toBeCloseTo(0, 6);
  });

  it("reads page by page (left first), top to bottom within each page", () => {
    const lines = stripReadsToLines(
      [
        read(line(600, 300, 900, 280), "right top", 1),
        read(line(100, 400, 400, 400), "left second", 0),
        read(line(600, 400, 900, 380), "right second", 1),
        read(line(100, 300, 400, 300), "left top", 0),
      ],
      1000,
      1000,
    );
    expect(lines.map((l) => [l.text, l.block])).toEqual([
      ["left top", 0],
      ["left second", 0],
      ["right top", 1],
      ["right second", 1],
    ]);
  });

  it("keeps tilted lines in order by where they cross the page's middle", () => {
    // A short line near the page's left edge sits below a long line that rises past it: its
    // own midpoint is higher than the long line's, but on the page it is the later line.
    const lines = stripReadsToLines(
      [
        read(line(100, 300, 900, 200), "first (long, rising)"),
        read(line(100, 330, 300, 310), "second (short)"),
      ],
      1000,
      1000,
    );
    expect(lines.map((l) => l.text)).toEqual(["first (long, rising)", "second (short)"]);
  });

  it("drops unsure reads, and marks with no letters (ornaments, page numbers)", () => {
    const lines = stripReadsToLines(
      [
        read(line(100, 100, 400, 100), "noise", 0, 0.3),
        read(line(100, 200, 400, 200), "— 9 —"),
        read(line(100, 300, 400, 300), "Real text"),
      ],
      1000,
      1000,
    );
    expect(lines.map((l) => l.text)).toEqual(["Real text"]);
  });
});
