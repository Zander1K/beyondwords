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
    expect(second.store.getState().item).toEqual({
      kind: "phrase",
      text: "of the grey cliffs,",
    });
    second.dispose();
  });
});

describe("checkpoint: keys move the highlight in the panel", () => {
  it("ArrowRight / ArrowDown / Enter / Escape change the scene through the adapter", async () => {
    const target = new EventTarget();
    const adapter = new WebSimulatorAdapter({ keyTarget: target, startDelayMs: 0 });
    adapter.setMaxUpdatesPerSecond(20);
    await adapter.session.start();
    // The controller's wiring: gesture -> reader store -> whole scene.
    const show = () => {
      const { page, reader } = useReaderStore.getState();
      renderReader(adapter, page, reader);
    };
    adapter.onGesture((g) => {
      useReaderStore.getState().applyGesture(g);
      show();
    });
    show();
    const press = (key: string) =>
      target.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key }));
    const item = () => adapter.store.getState().item;

    expect(item()).toEqual({ kind: "phrase", text: "The old lighthouse", emphasis: [8, 18] });
    press("ArrowRight");
    await new Promise((r) => setTimeout(r, 60));
    expect(item()).toEqual({ kind: "phrase", text: "stood alone" });
    press("ArrowDown");
    await new Promise((r) => setTimeout(r, 60));
    expect(item()).toEqual({ kind: "phrase", text: "at the edge" });
    press("ArrowUp");
    await new Promise((r) => setTimeout(r, 60));
    press("Enter");
    await new Promise((r) => setTimeout(r, 60));
    expect(item()).toMatchObject({ kind: "word", word: "lighthouse", focused: "hear" });
    press("Escape");
    await new Promise((r) => setTimeout(r, 60));
    expect(item()).toMatchObject({ kind: "phrase", text: "The old lighthouse" });
    expect(adapter.store.getState().scene).not.toBeNull();
    adapter.dispose();
  });
});

describe("SIM-VIS-04 hand lost", () => {
  it("shows the hand-lost status ahead of other statuses", async () => {
    const { statusFor } = await import("@/screens/reader/useReaderController");
    expect(statusFor({ status: "idle" }, true)).toBe("hand-lost");
    expect(statusFor({ status: "scanning", source: "camera" }, false)).toBe("thinking");
    expect(
      statusFor({ status: "ready", source: "camera", lines: 3, ocrMs: 200 }, false),
    ).toBeNull();
  });

  it("finger tracking moves the reader; a new line closes the word card", () => {
    const s = useReaderStore.getState();
    s.applyGesture("select");
    expect(useReaderStore.getState().reader.view).toBe("card");
    s.setPosition({ line: 0, phrase: 0 });
    expect(useReaderStore.getState().reader.view).toBe("card");
    s.setPosition({ line: 2, phrase: 1 });
    expect(useReaderStore.getState().reader).toMatchObject({
      position: { line: 2, phrase: 1 },
      view: "phrase",
    });
  });
});
