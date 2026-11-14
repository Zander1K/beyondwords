import { describe, expect, it } from "vitest";

import { SAMPLE_PAGE } from "./samplePage";
import { initialReaderState, readerStep, type ReaderState } from "./readerMachine";

const at = (line: number, phrase: number): ReaderState => ({
  ...initialReaderState,
  position: { line, phrase },
});

describe("readerStep", () => {
  it("moves phrase by phrase across lines with right/left", () => {
    const a = readerStep(SAMPLE_PAGE, initialReaderState, "right");
    expect(a.state.position).toEqual({ line: 0, phrase: 1 });
    const b = readerStep(SAMPLE_PAGE, a.state, "right");
    expect(b.state.position).toEqual({ line: 1, phrase: 0 });
    expect(readerStep(SAMPLE_PAGE, b.state, "left").state.position).toEqual({ line: 0, phrase: 1 });
  });

  it("moves line by line with down/up and stops at both ends", () => {
    expect(readerStep(SAMPLE_PAGE, at(0, 1), "down").state.position).toEqual({
      line: 1,
      phrase: 0,
    });
    expect(readerStep(SAMPLE_PAGE, initialReaderState, "up").outcome).toBe("boundary");
    expect(readerStep(SAMPLE_PAGE, at(3, 1), "right").outcome).toBe("boundary");
    expect(readerStep(SAMPLE_PAGE, at(3, 0), "down").outcome).toBe("boundary");
  });

  it("opens the word card on select, activates its action, closes on back", () => {
    const opened = readerStep(SAMPLE_PAGE, initialReaderState, "select");
    expect(opened.outcome).toBe("card-opened");
    expect(opened.state.view).toBe("card");
    expect(readerStep(SAMPLE_PAGE, opened.state, "select").outcome).toEqual({ action: "hear" });
    // Navigation is frozen while the card is open.
    expect(readerStep(SAMPLE_PAGE, opened.state, "down").outcome).toBe("boundary");
    const closed = readerStep(SAMPLE_PAGE, opened.state, "back");
    expect(closed.state.view).toBe("phrase");
    expect(closed.state.position).toEqual({ line: 0, phrase: 0 });
  });

  it("reports phrases without a hard word and back on the root", () => {
    expect(readerStep(SAMPLE_PAGE, at(0, 1), "select").outcome).toBe("no-word");
    expect(readerStep(SAMPLE_PAGE, initialReaderState, "back").outcome).toBe("root");
  });
});
