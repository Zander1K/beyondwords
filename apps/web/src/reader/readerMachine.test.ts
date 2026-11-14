import { describe, expect, it } from "vitest";

import { initialReaderState, readerStep } from "./readerMachine";

const hasWord = (i: number) => i !== 1;

describe("readerStep", () => {
  it("moves between phrases and stops at both ends", () => {
    expect(readerStep(initialReaderState, "prev", 3, hasWord).outcome).toBe("boundary");
    const step = readerStep(initialReaderState, "next", 3, hasWord);
    expect(step).toEqual({ state: { index: 1, view: "phrase" }, outcome: "moved" });
    expect(readerStep({ index: 2, view: "phrase" }, "next", 3, hasWord).outcome).toBe("boundary");
  });

  it("opens a word card on select and returns to the phrase on dismiss", () => {
    const word = readerStep(initialReaderState, "select", 3, hasWord);
    expect(word.state.view).toBe("word");
    expect(readerStep(word.state, "dismiss", 3, hasWord).state.view).toBe("phrase");
    expect(readerStep({ index: 1, view: "phrase" }, "select", 3, hasWord).outcome).toBe("no-word");
  });

  it("clears on dismiss and restores on select", () => {
    const cleared = readerStep(initialReaderState, "dismiss", 3, hasWord);
    expect(cleared.state.view).toBe("cleared");
    expect(readerStep(cleared.state, "select", 3, hasWord).state.view).toBe("phrase");
  });
});
