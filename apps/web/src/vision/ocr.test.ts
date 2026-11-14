import { describe, expect, it } from "vitest";

import { normaliseLines, type RawLine } from "./ocr";

const raw = (text: string, confidence: number, y: number): RawLine => ({
  text,
  confidence,
  bbox: { x0: 200, y0: y, x1: 800, y1: y + 40 },
  baseline: { x0: 200, y0: y + 32, x1: 800, y1: y + 30 },
});

describe("normaliseLines (SIM-VIS-02)", () => {
  it("normalises boxes and baselines to 0-1 and sorts top to bottom", () => {
    const lines = normaliseLines(
      [raw("of the grey cliffs,", 94, 200), raw("The old lighthouse", 96, 100)],
      1000,
      500,
    );
    expect(lines.map((l) => l.text)).toEqual(["The old lighthouse", "of the grey cliffs,"]);
    expect(lines[0]?.box).toEqual({ x: 0.2, y: 0.2, w: 0.6, h: 0.08 });
    expect(lines[0]?.baseline).toEqual({ x0: 0.2, y0: 0.264, x1: 0.8, y1: 0.26 });
  });

  it("drops low-confidence lines and lines that are mostly not letters", () => {
    const lines = normaliseLines(
      [
        raw("— 42 —", 90, 10),
        raw("%%@#|", 60, 50),
        raw("blurry words", 20, 90),
        raw("Real text\n", 88, 130),
      ],
      1000,
      500,
    );
    expect(lines.map((l) => l.text)).toEqual(["Real text"]);
  });
});
