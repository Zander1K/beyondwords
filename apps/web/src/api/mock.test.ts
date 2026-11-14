import { describe, expect, it } from "vitest";

import { phraseSpan } from "@/reader";

import { mockAnalyzePage, mockDefineWord, splitPhrases } from "./mock";

const box = { x: 0.2, y: 0.1, w: 0.6, h: 0.05 };
const baseline = { x0: 0.2, y0: 0.14, x1: 0.8, y1: 0.14 };

describe("MOCK page analysis", () => {
  it("splits phrases at punctuation and keeps them short", () => {
    expect(splitPhrases("of the grey cliffs, and every night its lamp")).toEqual([
      "of the grey cliffs,",
      "and every night its lamp",
    ]);
    const long = splitPhrases("one two three four five six seven eight nine ten");
    expect(long.every((p) => p.split(" ").length <= 6)).toBe(true);
    expect(long.join(" ")).toBe("one two three four five six seven eight nine ten");
    expect(splitPhrases("in the dark. At the top, the")).toEqual([
      "in the dark.",
      "At the top, the",
    ]);
  });

  it("builds page lines with boxes, phrases and at most one hard word per phrase", async () => {
    const page = await mockAnalyzePage([
      { text: "The old lighthouse stood alone at the edge", box, baseline },
    ]);
    const line = page.lines[0];
    expect(line?.box).toEqual(box);
    expect(line?.phrases.map((p) => p.text)).toEqual([
      "The old lighthouse stood",
      "alone at the edge",
    ]);
    expect(line?.phrases[0]?.hardWord?.card.word).toBe("lighthouse");
    expect(line?.phrases[0]?.hardWord?.range).toEqual([8, 18]);
    expect(line?.text).toBe("The old lighthouse stood alone at the edge");
  });

  it("phraseSpan locates a phrase along its line", async () => {
    const page = await mockAnalyzePage([{ text: "aaaa, bbbb cccc", box, baseline }]);
    expect(phraseSpan(page, { line: 0, phrase: 1 })).toEqual([0.4, 1]);
  });
});

describe("MOCK word lookup", () => {
  it("defines a word, ignoring the punctuation around it", () => {
    const card = mockDefineWord("“lighthouse,”");
    expect(card.word).toBe("lighthouse");
    expect(card.problem).toBeUndefined();
    expect(card.short).not.toBe("");
  });

  it("finds no definition for a stray mark or an OCR misread", () => {
    expect(mockDefineWord("—")).toMatchObject({ problem: "not-found", short: "" });
    expect(mockDefineWord("l")).toMatchObject({ problem: "not-found" });
    expect(mockDefineWord("qzx7")).toMatchObject({ word: "qzx", problem: "not-found" });
  });
});
