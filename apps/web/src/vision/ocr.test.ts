import { describe, expect, it } from "vitest";

import { charWidth, splitItem, toOcrLines } from "./ocr";

const item = (text: string, x: number, y: number, width: number, confidence = 0.97) => ({
  text,
  box: { x, y, width, height: 40 },
  confidence,
});

describe("splitItem", () => {
  it("splits a line box into words that fill it in order, wider words wider", () => {
    const words = splitItem(item("The old lighthouse", 100, 50, 600));
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

describe("toOcrLines", () => {
  it("normalises lines and words, with word offsets that match the line text", () => {
    const lines = toOcrLines(
      [
        [item("of the grey", 200, 300, 300), item("cliffs,", 520, 300, 120)],
        [item("The old lighthouse", 200, 200, 500)],
      ],
      1000,
      1000,
    );
    expect(lines.map((l) => l.text)).toEqual(["The old lighthouse", "of the grey cliffs,"]);
    const line = lines[1];
    expect(line?.box).toEqual({ x: 0.2, y: 0.3, w: 0.44, h: 0.04 });
    expect(line?.words.map((w) => line.text.slice(w.start, w.end))).toEqual([
      "of",
      "the",
      "grey",
      "cliffs,",
    ]);
    expect(line?.baseline.y0).toBeCloseTo(0.3 + 0.04 * 0.78, 5);
  });

  it("drops low-confidence lines and lines without letters", () => {
    const lines = toOcrLines(
      [
        [item("— 42 —", 0, 0, 100)],
        [item("noise", 0, 100, 100, 0.3)],
        [item("Real text", 0, 200, 100)],
      ],
      1000,
      1000,
    );
    expect(lines.map((l) => l.text)).toEqual(["Real text"]);
  });
});
