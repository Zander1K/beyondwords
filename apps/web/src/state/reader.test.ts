import { beforeEach, describe, expect, it } from "vitest";

import { WebSimulatorAdapter } from "@/glasses/web-simulator/WebSimulatorAdapter";
import { DEMO_PAGE, initialReaderState } from "@/reader";
import { renderReader } from "@/screens/reader/useReaderController";

import { useReaderStore } from "./reader";

beforeEach(() => useReaderStore.setState({ page: DEMO_PAGE, reader: initialReaderState }));

describe("SIM-SES-07 phone is the source of truth", () => {
  it("keeps the reading position when the adapter is torn down and recreated", async () => {
    useReaderStore.getState().applyGesture("down");
    useReaderStore.getState().applyGesture("right");
    const position = useReaderStore.getState().reader.position;
    expect(position).toEqual({ line: 1, phrase: 1 });

    const first = new WebSimulatorAdapter({ keyTarget: new EventTarget(), startDelayMs: 0 });
    await first.session.start();
    first.dispose();

    const second = new WebSimulatorAdapter({ keyTarget: new EventTarget(), startDelayMs: 0 });
    await second.session.start();
    const { page, reader } = useReaderStore.getState();
    renderReader(second, page, reader);
    expect(reader.position).toEqual(position);
    expect(second.store.getState().content).toEqual({
      kind: "phrase",
      text: "of the grey cliffs,",
    });
    second.dispose();
  });
});
