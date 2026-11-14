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

describe("pointing at a word", () => {
  it("highlights the pointed word on the glasses and opens its card on select", async () => {
    const { mockAnalyzePage } = await import("@/api/mock");
    const words = [
      { text: "swept", box: { x: 0.2, y: 0.1, w: 0.1, h: 0.05 }, start: 0, end: 5 },
      { text: "slowly", box: { x: 0.31, y: 0.1, w: 0.12, h: 0.05 }, start: 6, end: 12 },
      { text: "across", box: { x: 0.44, y: 0.1, w: 0.12, h: 0.05 }, start: 13, end: 19 },
    ];
    const page = await mockAnalyzePage([
      {
        text: "swept slowly across",
        box: { x: 0.2, y: 0.1, w: 0.36, h: 0.05 },
        baseline: { x0: 0.2, y0: 0.14, x1: 0.56, y1: 0.14 },
        words,
      },
    ]);
    useReaderStore.getState().setPage(page);
    useReaderStore.getState().setPosition({ line: 0, phrase: 0, word: 1 });

    const adapter = new WebSimulatorAdapter({ keyTarget: new EventTarget(), startDelayMs: 0 });
    await adapter.session.start();
    let { reader } = useReaderStore.getState();
    renderReader(adapter, page, reader);
    expect(adapter.store.getState().item).toEqual({
      kind: "phrase",
      text: "swept slowly across",
      emphasis: [6, 12],
    });

    useReaderStore.getState().applyGesture("select");
    reader = useReaderStore.getState().reader;
    expect(reader.view).toBe("card");
    expect(reader.card?.word).toBe("slowly");
    adapter.dispose();
  });
});

describe("continuous scanning in the store", () => {
  it("keeps the reader on its line across reads and starts over on a page turn", async () => {
    const { mockAnalyzePage } = await import("@/api/mock");
    const mk = (texts: string[], top = 0) =>
      mockAnalyzePage(
        texts.map((text, i) => ({
          text,
          box: { x: 0.2, y: 0.1 + (i + top) * 0.1, w: 0.6, h: 0.05 },
          baseline: { x0: 0.2, y0: 0.14 + (i + top) * 0.1, x1: 0.8, y1: 0.14 + (i + top) * 0.1 },
        })),
      );
    const lines = ["the old lighthouse stood", "at the edge of cliffs", "and every night its lamp"];
    const s = useReaderStore.getState;
    expect(s().mergeScan(await mk(lines), null)).toBe(true); // replaces the demo page
    s().setPosition({ line: 2, phrase: 0 });
    const id = s().page.id;

    // Next read misses the first line (hand over it): the reader stays on "and every night".
    expect(s().mergeScan(await mk(lines.slice(1), 1), { x: 0, y: 0, w: 1, h: 0.18 })).toBe(false);
    expect(s().page.id).toBe(id);
    expect(s().page.lines[s().reader.position.line]?.text).toBe("and every night its lamp");

    // Page turned.
    expect(s().mergeScan(await mk(["chapter two begins here", "with a storm at sea"]), null)).toBe(
      true,
    );
    expect(s().reader.position).toEqual({ line: 0, phrase: 0 });
  });

  it("does not change the glasses key when a read finds the same text", async () => {
    const { readerViewKey } = await import("@/screens/reader/useReaderController");
    const { mockAnalyzePage } = await import("@/api/mock");
    const read = () =>
      mockAnalyzePage([
        {
          text: "swept slowly across",
          box: { x: 0.2, y: 0.1, w: 0.4, h: 0.05 },
          baseline: { x0: 0.2, y0: 0.14, x1: 0.6, y1: 0.14 },
        },
      ]);
    const a = readerViewKey(await read(), initialReaderState);
    const b = readerViewKey(await read(), initialReaderState);
    expect(a).toBe(b);
  });
});
