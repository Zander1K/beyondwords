import { describe, expect, it } from "vitest";

import { matchWakePhrase } from "./voice";

describe("matchWakePhrase", () => {
  it("returns the command after the wake phrase", () => {
    expect(matchWakePhrase("Hey Meta, next line")).toBe("next line");
    expect(matchWakePhrase("hey meta what does lamp mean?")).toBe("what does lamp mean");
  });

  it("returns an empty command when only the wake phrase is said", () => {
    expect(matchWakePhrase("Hey Meta.")).toBe("");
  });

  it("ignores speech not addressed to the glasses", () => {
    expect(matchWakePhrase("next line")).toBeNull();
    expect(matchWakePhrase("they met a friend")).toBeNull();
  });
});
