import { describe, expect, it } from "vitest";

import { mapPosition, mergePages, textSimilarity } from "./pageMerge";
import { line, type Page, phrase } from "./page";

const TEXT = [
  "The old lighthouse stood alone",
  "at the edge of the grey cliffs,",
  "and every night its lamp swept",
  "slowly across the restless water.",
];

/** A page with the given line indices of TEXT, each 0.1 apart from y = 0.1. */
function pageOf(id: string, indices: number[], texts = TEXT): Page {
  return {
    id,
    lines: indices.map((i) => ({
      ...line(phrase(texts[i] ?? "")),
      box: { x: 0.2, y: 0.1 + i * 0.1, w: 0.6, h: 0.05 },
      baseline: { x0: 0.2, y0: 0.14 + i * 0.1, x1: 0.8, y1: 0.14 + i * 0.1 },
    })),
  };
}

describe("textSimilarity", () => {
  it("is the share of the new read's words found in the old text", () => {
    expect(textSimilarity("the old lighthouse", "old lighthouse")).toBe(1);
    expect(textSimilarity("the old lighthouse", "a new boat")).toBe(0);
  });
});

describe("mergePages (continuous scanning)", () => {
  it("keeps lines hidden under the hand in this read", () => {
    const prev = pageOf("p1", [0, 1, 2, 3]);
    const next = pageOf("scan-2", [0, 1]); // the hand covers lines 2 and 3
    const hand = { x: 0.3, y: 0.3, w: 0.4, h: 0.3 };
    const { page, newPage } = mergePages(prev, next, hand);
    expect(newPage).toBe(false);
    expect(page.id).toBe("p1");
    expect(page.lines.map((l) => l.text)).toEqual(TEXT);
  });

  it("keeps the full reading of a line the hand cuts into fragments", () => {
    const prev = pageOf("p1", [0, 1]);
    const cut = [...TEXT];
    cut[1] = "at the edge cliffs,"; // the finger hid "of the grey"
    const next = pageOf("s", [0, 1], cut);
    const { page } = mergePages(prev, next, { x: 0.3, y: 0.15, w: 0.2, h: 0.5 });
    expect(page.lines.map((l) => l.text)).toEqual([TEXT[0], TEXT[1]]);
  });

  it("drops lines that are simply gone when no hand covers them", () => {
    const { page } = mergePages(pageOf("p1", [0, 1, 2, 3]), pageOf("s", [0, 1, 2]), null);
    expect(page.lines).toHaveLength(3);
  });

  it("prefers the fresh read of a line over the remembered one", () => {
    const prev = pageOf("p1", [0, 1]);
    const fixed = [...TEXT];
    fixed[1] = "at the edge of the grey cliffs, fixed";
    const next = pageOf("s", [0, 1], fixed);
    const hand = { x: 0, y: 0, w: 1, h: 1 };
    const { page } = mergePages(prev, next, hand);
    expect(page.lines.map((l) => l.text)).toEqual([TEXT[0], fixed[1]]);
  });

  it("treats a different text as a new page (page turned)", () => {
    const other = [
      "A completely different page",
      "about boats and the sea",
      "with nothing in common",
      "at all here",
    ];
    const { page, newPage } = mergePages(
      pageOf("p1", [0, 1, 2, 3]),
      pageOf("s", [0, 1, 2, 3], other),
      null,
    );
    expect(newPage).toBe(true);
    expect(page.id).toBe("s");
  });

  it("replaces the demo page on the first read", () => {
    expect(mergePages(pageOf("demo", [0]), pageOf("s", [0]), null, true).newPage).toBe(true);
  });
});

describe("mapPosition", () => {
  it("follows the current line when line indices shift between reads", () => {
    const prev = pageOf("p1", [1, 2, 3]); // index 1 = "and every night..."
    const next = pageOf("p1", [0, 1, 2, 3]); // a line appeared above
    expect(mapPosition(prev, next, { line: 1, phrase: 0, word: 2 })).toEqual({
      line: 2,
      phrase: 0,
    });
  });
});

describe("mergePages on a tilted page", () => {
  // Lines 0.05 apart, tilted so each one's box overlaps its neighbours' boxes.
  function tilted(id: string, indices: number[]): Page {
    return {
      id,
      lines: indices.map((i) => {
        const y = 0.2 + i * 0.05;
        return {
          ...line(phrase(TEXT[i] ?? "")),
          box: { x: 0.2, y: y - 0.06, w: 0.6, h: 0.12 },
          baseline: { x0: 0.2, y0: y + 0.03, x1: 0.8, y1: y - 0.03, height: 0.03 },
        };
      }),
    };
  }

  it("keeps a hidden line even though a visible neighbour's box overlaps it", () => {
    const prev = tilted("p1", [0, 1, 2, 3]);
    const next = tilted("scan-2", [0, 1, 3]); // the hand covers line 2
    const hand = { x: 0.4, y: 0.25, w: 0.2, h: 0.05 };
    const { page } = mergePages(prev, next, hand);
    expect(page.lines.map((l) => l.text)).toEqual(TEXT);
  });
});

describe("mergePages on an open book", () => {
  it("keeps reading order page by page, not interleaved by height", () => {
    const at = (text: string, block: number, x: number, y: number) => ({
      ...line(phrase(text)),
      block,
      box: { x, y: y - 0.03, w: 0.35, h: 0.04 },
      baseline: { x0: x, y0: y, x1: x + 0.35, y1: y, height: 0.03 },
    });
    const prev: Page = {
      id: "p1",
      lines: [at("old lighthouse stood", 0, 0.1, 0.2), at("restless water swept", 1, 0.55, 0.2)],
    };
    const next: Page = {
      id: "scan-2",
      lines: [
        at("restless water swept", 1, 0.55, 0.2),
        at("lamp swept slowly", 1, 0.55, 0.3),
        at("old lighthouse stood", 0, 0.1, 0.2),
        at("edge grey cliffs", 0, 0.1, 0.3),
      ],
    };
    const { page } = mergePages(prev, next, null);
    expect(page.lines.map((l) => l.text)).toEqual([
      "old lighthouse stood",
      "edge grey cliffs",
      "restless water swept",
      "lamp swept slowly",
    ]);
  });
});
