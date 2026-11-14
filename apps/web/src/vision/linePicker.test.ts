import { describe, expect, it } from "vitest";

import { line, type Page, phrase } from "@/reader";

import { initialPickerState, pickLine, type PickerState } from "./linePicker";

// Three lines, baselines at y = 0.20, 0.30, 0.40 from x 0.2 to 0.8, each 0.05 tall.
function makePage(): Page {
  const lines = ["aaaa bbbb, cccc dddd", "eeee ffff, gggg hhhh", "iiii jjjj, kkkk llll"].map(
    (text, i) => {
      const [a, b] = text.split(", ");
      const l = line(phrase(`${a},`), phrase(b ?? ""));
      const y = 0.2 + i * 0.1;
      return {
        ...l,
        box: { x: 0.2, y: y - 0.04, w: 0.6, h: 0.05 },
        baseline: { x0: 0.2, y0: y, x1: 0.8, y1: y },
      };
    },
  );
  return { id: "test", lines };
}

function run(page: Page, tips: { x: number; y: number }[], start = initialPickerState) {
  let state: PickerState = start;
  const lines: (number | undefined)[] = [];
  for (const tip of tips) {
    state = pickLine(page, tip, state);
    lines.push(state.position?.line);
  }
  return { state, lines };
}

describe("pickLine (SIM-VIS-03)", () => {
  it("picks the line the fingertip is under, not the one below it", () => {
    const { state } = run(makePage(), [{ x: 0.3, y: 0.22 }]);
    expect(state.position).toEqual({ line: 0, phrase: 0 });
  });

  it("moves to each line in order as the finger slides down three lines", () => {
    const page = makePage();
    const tips = [0.22, 0.22, 0.32, 0.32, 0.32, 0.42, 0.42, 0.42].map((y) => ({ x: 0.5, y }));
    const { lines } = run(page, tips);
    expect(lines).toEqual([0, 0, 0, 0, 1, 1, 1, 2]);
  });

  it("does not flicker when the tip jitters between two lines", () => {
    const page = makePage();
    const start = run(page, [{ x: 0.5, y: 0.22 }]).state;
    const jitter = [0.255, 0.27, 0.255, 0.272, 0.258, 0.27].map((y) => ({ x: 0.5, y }));
    const { lines } = run(page, jitter, start);
    expect(new Set(lines)).toEqual(new Set([0]));
  });

  it("holds the last line when the tip is away from the text", () => {
    const page = makePage();
    const start = run(page, [{ x: 0.5, y: 0.32 }]).state;
    const { state } = run(page, [{ x: 0.97, y: 0.9 }], start);
    expect(state.position?.line).toBe(0 + 1);
  });

  it("picks the phrase along the line", () => {
    const page = makePage();
    expect(run(page, [{ x: 0.25, y: 0.22 }]).state.position?.phrase).toBe(0);
    expect(run(page, [{ x: 0.75, y: 0.22 }]).state.position?.phrase).toBe(1);
  });
});

describe("word under the fingertip", () => {
  // One line "The old lighthouse stood" with known word boxes, baseline y = 0.2.
  function wordPage(): Page {
    const words = [
      { text: "The", box: { x: 0.2, y: 0.16, w: 0.08, h: 0.05 }, start: 0, end: 3 },
      { text: "old", box: { x: 0.3, y: 0.16, w: 0.08, h: 0.05 }, start: 4, end: 7 },
      { text: "lighthouse", box: { x: 0.4, y: 0.16, w: 0.25, h: 0.05 }, start: 8, end: 18 },
      { text: "stood", box: { x: 0.67, y: 0.16, w: 0.13, h: 0.05 }, start: 19, end: 24 },
    ];
    const l = line(phrase("The old lighthouse"), phrase("stood"));
    return {
      id: "w",
      lines: [
        {
          ...l,
          words,
          box: { x: 0.2, y: 0.16, w: 0.6, h: 0.05 },
          baseline: { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.2 },
        },
      ],
    };
  }

  it("picks the exact word above the fingertip and the phrase containing it", () => {
    const page = wordPage();
    expect(run(page, [{ x: 0.5, y: 0.22 }]).state.position).toEqual({
      line: 0,
      phrase: 0,
      word: 2,
    });
    expect(run(page, [{ x: 0.33, y: 0.22 }]).state.position).toEqual({
      line: 0,
      phrase: 0,
      word: 1,
    });
    expect(run(page, [{ x: 0.72, y: 0.22 }]).state.position).toEqual({
      line: 0,
      phrase: 1,
      word: 3,
    });
  });

  it("does not flicker to the neighbouring word right at the edge", () => {
    const page = wordPage();
    const start = run(page, [{ x: 0.6, y: 0.22 }]).state; // on "lighthouse"
    const { state } = run(
      page,
      [
        { x: 0.66, y: 0.22 },
        { x: 0.665, y: 0.22 },
      ],
      start,
    );
    expect(state.position?.word).toBe(2);
    expect(run(page, [{ x: 0.75, y: 0.22 }], state).state.position?.word).toBe(3);
  });
});
