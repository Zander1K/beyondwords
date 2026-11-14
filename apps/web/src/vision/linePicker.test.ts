import { describe, expect, it } from "vitest";

import { line, type Page, phrase } from "@/reader";

import { initialPickerState, pickLine, PICK_THRESHOLDS, type PickerState } from "./linePicker";

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
    // Moving clearly onto "stood" does move the focus, but only once it has held for a moment.
    const onStood = Array.from({ length: PICK_THRESHOLDS.wordConfirmFrames }, () => ({
      x: 0.77,
      y: 0.22,
    }));
    expect(run(page, onStood, state).state.position?.word).toBe(3);
  });

  it("holds the focus on a word while the finger only passes over the next one", () => {
    const page = wordPage();
    const start = run(page, [{ x: 0.5, y: 0.22 }]).state; // on "lighthouse"
    const pass = Array.from({ length: PICK_THRESHOLDS.wordConfirmFrames - 1 }, () => ({
      x: 0.77,
      y: 0.22,
    }));
    // Just under the confirmation time on "stood", then back: the focus never moved.
    const { state } = run(page, [...pass, { x: 0.5, y: 0.22 }], start);
    expect(state.position?.word).toBe(2);
  });

  it("does not hop between words when the fingertip jitters across a boundary", () => {
    const page = wordPage();
    const start = run(page, [{ x: 0.5, y: 0.22 }]).state; // on "lighthouse"
    // Alternating in and out of "stood" every frame for a long time.
    const jitter = Array.from({ length: 60 }, (_, i) => ({ x: i % 2 ? 0.77 : 0.6, y: 0.22 }));
    const words = run(page, jitter, start).state.position?.word;
    expect(words).toBe(2);
  });

  it("a word that has held keeps the focus until the finger really leaves it", () => {
    const page = wordPage();
    let { state } = run(
      page,
      Array.from({ length: PICK_THRESHOLDS.wordConfirmFrames }, () => ({ x: 0.77, y: 0.22 })),
      run(page, [{ x: 0.5, y: 0.22 }]).state,
    );
    expect(state.position?.word).toBe(3);
    // A slight drift back toward the neighbour's edge is inside the slack: still "stood".
    state = run(page, [{ x: 0.655, y: 0.22 }], state).state;
    expect(state.position?.word).toBe(3);
  });
});

describe("pickLine on a tilted page", () => {
  it("measures distance to a line with its text height, not its (taller) box", () => {
    // Two lines 0.05 apart whose boxes are 0.15 tall because the page is tilted.
    const lines = ["aaaa bbbb", "cccc dddd"].map((text, i) => {
      const y = 0.3 + i * 0.05;
      return {
        ...line(phrase(text)),
        box: { x: 0.2, y: y - 0.1, w: 0.6, h: 0.15 },
        baseline: { x0: 0.2, y0: y + 0.04, x1: 0.8, y1: y - 0.04, height: 0.03 },
      };
    });
    const page: Page = { id: "tilted", lines };
    // Just under the second line at its middle (baseline y = 0.35 there).
    const state = pickLine(page, { x: 0.5, y: 0.36 }, initialPickerState);
    expect(state.position?.line).toBe(1);
    // Far below both lines (more than 2.2 text heights): not near any line.
    expect(pickLine(page, { x: 0.5, y: 0.5 }, initialPickerState).position).toBeNull();
  });
});

describe("pickLine: touching the word or pointing under it", () => {
  // Book-like spacing: baselines 0.06 apart, text 0.035 tall.
  const page: Page = {
    id: "book",
    lines: ["aaaa bbbb", "cccc dddd", "eeee ffff"].map((text, i) => {
      const y = 0.3 + i * 0.06;
      return {
        ...line(phrase(text)),
        box: { x: 0.2, y: y - 0.027, w: 0.6, h: 0.035 },
        baseline: { x0: 0.2, y0: y, x1: 0.8, y1: y, height: 0.035 },
      };
    }),
  };

  it("picks the touched line when the fingertip is on the word", () => {
    // Middle of line 1's text (baseline 0.36, text from 0.333).
    expect(pickLine(page, { x: 0.3, y: 0.347 }, initialPickerState).position?.line).toBe(1);
  });

  it("picks the line above when the fingertip is just under it", () => {
    expect(pickLine(page, { x: 0.3, y: 0.37 }, initialPickerState).position?.line).toBe(1);
  });
});

describe("pickLine on a bowed (curled) page", () => {
  // Two lines 0.04 apart whose middles sag 0.03 (almost a line's spacing) below their ends.
  const page: Page = {
    id: "curled",
    lines: ["aaaa bbbb", "cccc dddd"].map((text, i) => {
      const y = 0.4 + i * 0.04;
      return {
        ...line(phrase(text)),
        box: { x: 0.2, y: y - 0.03, w: 0.6, h: 0.05 },
        baseline: { x0: 0.2, y0: y, x1: 0.8, y1: y, height: 0.025, bow: 0.03 },
      };
    }),
  };

  it("finds the line where the text is, not where its chord is", () => {
    // In the middle the first line sits at 0.4 + 0.03 = 0.43 (its chord is at 0.40, and the
    // second line's chord at 0.44 is nearer to a tip at 0.425).
    const tip = { x: 0.5, y: 0.43 };
    expect(pickLine(page, tip, initialPickerState).position?.line).toBe(0);
    // Without the bow the same tip would be taken for the second line.
    const straight: Page = {
      ...page,
      lines: page.lines.map((l) => ({
        ...l,
        baseline: l.baseline && { ...l.baseline, bow: 0 },
      })),
    };
    expect(pickLine(straight, tip, initialPickerState).position?.line).toBe(1);
  });
});
