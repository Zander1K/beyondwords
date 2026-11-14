import { describe, expect, it } from "vitest";

import { LOADING_SHORT } from "@/api";

import { cardSpeech, cardToAutoRead } from "./cardSpeech";

describe("card speech", () => {
  it("reads a word card as the word then its meaning", () => {
    expect(cardToAutoRead({ word: "lantern", short: "A light in a case." })).toBe(
      "lantern. A light in a case.",
    );
  });

  it("reads an answer or notice as just its text, with no title in front", () => {
    const answer = { word: "Answer", short: "A lantern is a light.", say: "A lantern is a light." };
    expect(cardToAutoRead(answer)).toBe("A lantern is a light.");
    expect(cardSpeech(answer)).toBe("A lantern is a light.");
  });

  it("stays quiet for anything that is not content yet", () => {
    expect(cardToAutoRead(undefined)).toBeNull();
    expect(cardToAutoRead({ word: "lantern", short: LOADING_SHORT })).toBeNull(); // still being looked up
    expect(cardToAutoRead({ word: "lantern", short: "", problem: "load-failed" })).toBeNull();
    expect(cardToAutoRead({ word: "Answer", short: "Thinking…", pending: true })).toBeNull();
    expect(cardToAutoRead({ word: "lantern", short: "   " })).toBeNull();
  });
});
