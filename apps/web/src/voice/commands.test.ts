import { describe, expect, it } from "vitest";

import { parseVoiceCommand } from "./commands";

describe("parseVoiceCommand", () => {
  it.each([
    ["next", "next"],
    ["Next line.", "next"],
    ["go back", "prev"],
    ["read this", "read"],
    ["Stop!", "stop"],
    ["take a photo", "capture"],
    ["please capture the page", "capture"],
    ["show the camera", "viewfinder"],
    ["close", "dismiss"],
  ] as const)("%s -> %s", (text, kind) => {
    expect(parseVoiceCommand(text).kind).toBe(kind);
  });

  it("extracts the word to define", () => {
    expect(parseVoiceCommand("What does lighthouse mean?")).toEqual({
      kind: "define",
      word: "lighthouse",
    });
    expect(parseVoiceCommand("define restless")).toEqual({ kind: "define", word: "restless" });
    expect(parseVoiceCommand("what does the word lamp mean")).toEqual({
      kind: "define",
      word: "lamp",
    });
    // Definitions win over navigation words.
    expect(parseVoiceCommand("what does next mean")).toEqual({ kind: "define", word: "next" });
  });

  it("leaves real questions for the assistant", () => {
    expect(parseVoiceCommand("why did the lighthouse keeper leave the island").kind).toBe(
      "unknown",
    );
    expect(parseVoiceCommand("what is going on in this chapter").kind).toBe("unknown");
    expect(parseVoiceCommand("   ").kind).toBe("unknown");
  });
});
