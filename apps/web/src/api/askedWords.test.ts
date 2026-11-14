import { describe, expect, it } from "vitest";

import { wordsAskedAbout } from "./askedWords";

const page = ["The", "portcullis", "groaned", "upward", "as", "the", "knight", "waited."];

describe("wordsAskedAbout", () => {
  it("finds the word a meaning question is about, if it is on the page", () => {
    expect(wordsAskedAbout("What does portcullis mean?", page)).toEqual(["portcullis"]);
    expect(wordsAskedAbout("how do you pronounce Portcullis", page)).toEqual(["portcullis"]);
  });

  it("falls back to the pointed word when the question names none", () => {
    expect(wordsAskedAbout("What does this mean?", page, "groaned,")).toEqual(["groaned"]);
  });

  it("ignores a question that is not about a word", () => {
    expect(wordsAskedAbout("Why did the knight wait?", page, "knight")).toEqual([]);
  });

  it("does not take a word that is not on the page, or an everyday word", () => {
    expect(wordsAskedAbout("What does lantern mean?", page)).toEqual([]);
    expect(wordsAskedAbout("What does the word mean?", page)).toEqual([]);
  });

  it("keeps at most a few", () => {
    const many = ["alpha", "bravo", "charlie", "delta"];
    expect(wordsAskedAbout("what do alpha bravo charlie delta mean", many)).toHaveLength(3);
  });
});
