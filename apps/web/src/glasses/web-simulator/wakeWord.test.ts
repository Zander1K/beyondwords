import { describe, expect, it } from "vitest";

import { matchesWakePhrase } from "./wakeWord";

describe("wake phrase", () => {
  it("hears Hey Meta however it is written down", () => {
    for (const heard of [
      "Hey Meta",
      "hey meta",
      "Hey, Meta!",
      "hey meta what does lantern mean",
      "ok meta",
      "so hey meta can you help",
      "Hey Meda",
      "hey metta",
      "HEY   META",
    ]) {
      expect(matchesWakePhrase(heard), heard).toBe(true);
    }
  });

  it("ignores everything else, including words that merely contain 'meta'", () => {
    for (const heard of [
      "",
      "hey there",
      "meta",
      "the metal door",
      "metaphor and simile",
      "Meta Platforms announced",
      "hey metaphor",
      "they metallurgists",
      "this is a meta analysis",
      "what a meta joke",
    ]) {
      expect(matchesWakePhrase(heard), heard).toBe(false);
    }
  });
});
