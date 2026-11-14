import { describe, expect, it } from "vitest";

import { DEMO_PAGE } from "./demoPhrases";
import { initialReaderState, readerStep, type ReaderState } from "./readerMachine";

const at = (line: number, phrase: number): ReaderState => ({
  ...initialReaderState,
  position: { line, phrase },
});

describe("readerStep", () => {
  it("moves phrase by phrase across lines with right/left", () => {
    const a = readerStep(DEMO_PAGE, initialReaderState, "right");
    expect(a.state.position).toEqual({ line: 0, phrase: 1 });
    const b = readerStep(DEMO_PAGE, a.state, "right");
    expect(b.state.position).toEqual({ line: 1, phrase: 0 });
    expect(readerStep(DEMO_PAGE, b.state, "left").state.position).toEqual({ line: 0, phrase: 1 });
  });

  it("moves line by line with down/up and stops at both ends", () => {
    expect(readerStep(DEMO_PAGE, at(0, 1), "down").state.position).toEqual({ line: 1, phrase: 0 });
    expect(readerStep(DEMO_PAGE, initialReaderState, "up").outcome).toBe("boundary");
    expect(readerStep(DEMO_PAGE, at(3, 1), "right").outcome).toBe("boundary");
    expect(readerStep(DEMO_PAGE, at(3, 0), "down").outcome).toBe("boundary");
  });

  it("opens the word card on select, activates its action, closes on back", () => {
    const opened = readerStep(DEMO_PAGE, initialReaderState, "select");
    expect(opened.outcome).toBe("card-opened");
    expect(opened.state.view).toBe("card");
    expect(readerStep(DEMO_PAGE, opened.state, "select").outcome).toEqual({ action: "hear" });
    // Navigation is frozen while the card is open.
    expect(readerStep(DEMO_PAGE, opened.state, "down").outcome).toBe("boundary");
    const closed = readerStep(DEMO_PAGE, opened.state, "back");
    expect(closed.state.view).toBe("phrase");
    expect(closed.state.position).toEqual({ line: 0, phrase: 0 });
  });

  it("reports phrases without a hard word and back on the root", () => {
    expect(readerStep(DEMO_PAGE, at(0, 1), "select").outcome).toBe("no-word");
    expect(readerStep(DEMO_PAGE, initialReaderState, "back").outcome).toBe("root");
  });
});
