import { describe, expect, it } from "vitest";

import { line, type Page, phrase } from "@/reader";

import {
  computeHighlight,
  corners,
  easePoly,
  NO_HIGHLIGHT,
  type Poly,
  polyGap,
} from "./overlayGeometry";

/** A 16:9 image: aspect (height / width) is 0.5625. */
const ASPECT = 9 / 16;

/** The four corners of a band (top-left, top-right, bottom-right, bottom-left). */
const c4 = (p: Poly | null) => corners(p ?? Array.from({ length: 4 }, () => ({ x: 0, y: 0 })));

function makePage(tilt = 0, bow = 0): Page {
  const l = line(phrase("The old lighthouse"), phrase("stood alone"));
  const words = [
    { text: "The", start: 0, end: 3, box: { x: 0.2, y: 0.28, w: 0.06, h: 0.04 } },
    { text: "old", start: 4, end: 7, box: { x: 0.28, y: 0.28, w: 0.06, h: 0.04 } },
    { text: "lighthouse", start: 8, end: 18, box: { x: 0.36, y: 0.28, w: 0.16, h: 0.04 } },
    { text: "stood", start: 19, end: 24, box: { x: 0.54, y: 0.28, w: 0.09, h: 0.04 } },
    { text: "alone", start: 25, end: 30, box: { x: 0.65, y: 0.28, w: 0.1, h: 0.04 } },
  ];
  return {
    id: "p",
    lines: [
      {
        ...l,
        words,
        box: { x: 0.2, y: 0.28, w: 0.55, h: 0.04 },
        baseline: { x0: 0.2, y0: 0.31, x1: 0.75, y1: 0.31 + tilt, height: 0.04, bow },
      },
    ],
  };
}

describe("computeHighlight", () => {
  it("has nothing for a line it knows nothing about", () => {
    expect(computeHighlight({ id: "x", lines: [] }, { line: 0, phrase: 0 }, ASPECT)).toEqual(
      NO_HIGHLIGHT,
    );
  });

  it("puts the phrase around exactly its words, and the word inside the phrase", () => {
    const h = computeHighlight(makePage(), { line: 0, phrase: 0, word: 2 }, ASPECT);
    if (!h.phrase || !h.word) throw new Error("expected a phrase and a word");
    const [pTL, pTR] = c4(h.phrase);
    const [wTL, wTR] = c4(h.word);
    // "The old lighthouse" spans x 0.20 to 0.52, with a little padding either side.
    expect(pTL.x).toBeLessThan(0.2);
    expect(pTL.x).toBeGreaterThan(0.17);
    expect(pTR.x).toBeGreaterThan(0.52);
    expect(pTR.x).toBeLessThan(0.56);
    // "lighthouse" is 0.36 to 0.52, so it sits inside the phrase.
    expect(wTL.x).toBeGreaterThan(pTL.x);
    expect(wTR.x).toBeLessThan(pTR.x + 0.01);
    expect(wTL.x).toBeGreaterThan(0.34);
    // The second phrase starts after the first ends.
    const next = computeHighlight(makePage(), { line: 0, phrase: 1 }, ASPECT).phrase;
    expect(c4(next)[0].x).toBeGreaterThan(0.5);
  });

  it("pads the same number of pixels sideways and up (the image is not square)", () => {
    const h = computeHighlight(makePage(), { line: 0, phrase: 0, word: 0 }, ASPECT);
    const [tl] = c4(h.word);
    const W = 1600;
    const H = 900;
    const sidePx = (0.2 - tl.x) * W;
    const upPx = (0.31 - 0.04 * 0.78 - tl.y) * H;
    expect(sidePx).toBeCloseTo(upPx * (0.14 / 0.08), 0);
  });

  it("tilts with the line: the right end of a tilted line sits higher", () => {
    const [tl, tr, br, bl] = c4(
      computeHighlight(makePage(-0.04), { line: 0, phrase: 0 }, ASPECT).phrase,
    );
    expect(tr.y).toBeLessThan(tl.y);
    expect(br.y).toBeLessThan(bl.y);
    // A level line stays level.
    const [ltl, ltr] = c4(computeHighlight(makePage(), { line: 0, phrase: 0 }, ASPECT).phrase);
    expect(ltl.y).toBeCloseTo(ltr.y, 9);
  });

  it("bows with a curled page: the band follows a parabola through the line's sag", () => {
    const bow = 0.02; // half a text height, at the middle
    const line = computeHighlight(makePage(0, bow), { line: 0, phrase: 0 }, ASPECT).line;
    if (!line) throw new Error("expected a line");
    const steps = line.length / 2 - 1;
    // The band runs a little past each end of the line (padding), so t is not exactly 0 to 1.
    const padT = (0.9 * 0.04 * ASPECT) / 0.55;
    const top = line.slice(0, steps + 1);
    top.forEach((p, i) => {
      const t = -padT + ((1 + 2 * padT) * i) / steps;
      // Level chord at y = 0.31, the band's top 0.04 above it, plus the sag at t.
      expect(p.y).toBeCloseTo(0.31 - 0.04 + bow * 4 * t * (1 - t), 6);
    });
    // The middle sags the full bow below where a straight line would be.
    const mid = top[steps / 2];
    expect(mid?.y ?? 0).toBeCloseTo(0.31 - 0.04 + bow, 6);
    // The bottom edge follows the same curve.
    const bottom = line.slice(steps + 1).reverse();
    expect(bottom[steps / 2]?.y ?? 0).toBeCloseTo(0.31 + 0.04 * 0.44 + bow, 6);
    // A straight line has the same y along its top edge.
    const flat = computeHighlight(makePage(), { line: 0, phrase: 0 }, ASPECT).line ?? [];
    expect(flat[steps / 2]?.y).toBeCloseTo(flat[0]?.y ?? 1, 9);
  });

  it("keeps every band of one kind the same size, so it can ease", () => {
    const a = computeHighlight(makePage(), { line: 0, phrase: 0, word: 0 }, ASPECT);
    const b = computeHighlight(makePage(-0.03, 0.01), { line: 0, phrase: 1, word: 3 }, ASPECT);
    for (const key of ["line", "phrase", "word", "underline"] as const) {
      expect(a[key]?.length).toBe(b[key]?.length);
    }
  });

  it("underlines the pointed word only, just under the text", () => {
    expect(computeHighlight(makePage(), { line: 0, phrase: 0 }, ASPECT).underline).toBeNull();
    const u = computeHighlight(makePage(), { line: 0, phrase: 0, word: 0 }, ASPECT).underline;
    const [tl, tr, , bl] = c4(u);
    expect(tl.x).toBeCloseTo(0.2, 6);
    expect(tr.x).toBeCloseTo(0.26, 6);
    // A strip under the baseline (0.31), thinner than the text.
    expect(tl.y).toBeGreaterThan(0.31);
    expect(bl.y - tl.y).toBeLessThan(0.04 * 0.2);
  });

  it("falls back to character counts when the line has no word boxes", () => {
    const p = makePage();
    const plain: Page = { ...p, lines: p.lines.map((l) => ({ ...l, words: undefined })) };
    const h = computeHighlight(plain, { line: 0, phrase: 1 }, ASPECT);
    expect(h.phrase).not.toBeNull();
    expect(h.word).toBeNull();
  });
});

describe("easing", () => {
  const a = computeHighlight(makePage(), { line: 0, phrase: 0 }, ASPECT).phrase;
  const b = computeHighlight(makePage(), { line: 0, phrase: 1 }, ASPECT).phrase;

  it("glides toward the target and arrives", () => {
    let shown = a;
    const start = polyGap(shown, b);
    for (let i = 0; i < 40; i++) shown = easePoly(shown, b, 0.35);
    expect(start).toBeGreaterThan(0.1);
    expect(polyGap(shown, b)).toBeLessThan(0.001);
  });

  it("appears at its target, and goes away at once", () => {
    expect(easePoly(null, b, 0.3)).toBe(b);
    expect(easePoly(a, null, 0.3)).toBeNull();
  });
});
