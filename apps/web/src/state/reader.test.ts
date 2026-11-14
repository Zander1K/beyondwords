import { beforeEach, describe, expect, it } from "vitest";

import { WebSimulatorAdapter } from "@/glasses/web-simulator/WebSimulatorAdapter";
import { initialReaderState, line, type Page, phrase } from "@/reader";
import { SAMPLE_PAGE } from "@/reader/samplePage";
import { renderReader } from "@/screens/reader/useReaderController";

import { useReaderStore } from "./reader";

beforeEach(() => useReaderStore.setState({ page: SAMPLE_PAGE, reader: initialReaderState }));

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
    expect(statusFor({ status: "scanning" }, false)).toBe("reading");
    expect(statusFor({ status: "live", lines: 3, ocrMs: 200, scans: 1 }, false)).toBeNull();
  });

  it("says what went wrong: no page in view, the reader failing, a short-lived hint", async () => {
    const { statusFor } = await import("@/screens/reader/useReaderController");
    expect(statusFor({ status: "empty", ocrMs: 120 })).toBe("no-page");
    // A failed read is a failure, not just "no page", and outranks a lost hand.
    expect(statusFor({ status: "error", message: "x" })).toBe("load-failed");
    expect(statusFor({ status: "error", message: "x" }, true)).toBe("load-failed");
    // The hint (select with nothing pointed at) wins while it lasts.
    expect(statusFor({ status: "error", message: "x" }, true, "no-word")).toBe("no-word");
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

describe("an open word card follows the finger to the word it points at", () => {
  /** Two lines with word boxes: "The old lighthouse, stood alone" / "at the edge of narrow cliffs". */
  function pageWithWords(): Page {
    const mk = (text: string, y: number, splitAt: number) => {
      const parts = [text.slice(0, splitAt), text.slice(splitAt + 1)];
      const l = line(phrase(parts[0] ?? ""), phrase(parts[1] ?? ""));
      let offset = 0;
      const words = text.split(" ").map((w, i) => {
        const start = text.indexOf(w, offset);
        offset = start + w.length;
        return { text: w, start, end: offset, box: { x: 0.1 + i * 0.12, y, w: 0.1, h: 0.04 } };
      });
      return {
        ...l,
        words,
        box: { x: 0.1, y, w: 0.7, h: 0.04 },
        baseline: { x0: 0.1, y0: y + 0.03, x1: 0.8, y1: y + 0.03, height: 0.04 },
      };
    };
    return {
      id: "words",
      lines: [
        mk("The old lighthouse, stood alone", 0.2, 19),
        mk("at the edge of narrow cliffs", 0.3, 11),
      ],
    };
  }
  const store = () => useReaderStore.getState();

  beforeEach(() => useReaderStore.setState({ page: pageWithWords(), reader: initialReaderState }));

  it("opens on the word under the finger", () => {
    store().setPosition({ line: 0, phrase: 0, word: 2 });
    store().applyGesture("select");
    expect(store().reader.view).toBe("card");
    expect(store().reader.card?.word).toBe("lighthouse");
  });

  it("switches to a different word in the same phrase", () => {
    store().setPosition({ line: 0, phrase: 0, word: 2 });
    store().applyGesture("select");
    store().setPosition({ line: 0, phrase: 0, word: 1 });
    expect(store().reader.view).toBe("card");
    expect(store().reader.card?.word).toBe("old");
    expect(store().reader.position.word).toBe(1);
  });

  it("follows the finger to a word in another phrase or line instead of closing", () => {
    store().setPosition({ line: 0, phrase: 0, word: 2 });
    store().applyGesture("select");
    store().setPosition({ line: 0, phrase: 1, word: 4 });
    expect(store().reader).toMatchObject({ view: "card", card: { word: "alone" } });
    store().setPosition({ line: 1, phrase: 1, word: 4 });
    expect(store().reader).toMatchObject({ view: "card", card: { word: "narrow" } });
  });

  it("starts the new card with its first action focused", () => {
    store().setPosition({ line: 0, phrase: 0, word: 2 });
    store().applyGesture("select");
    useReaderStore.setState((s) => ({ reader: { ...s.reader, cardFocus: 1 } }));
    store().setPosition({ line: 0, phrase: 0, word: 1 });
    expect(store().reader.cardFocus).toBe(0);
  });

  it("keeps the card while the finger stays on the same word", () => {
    store().setPosition({ line: 0, phrase: 0, word: 2 });
    store().applyGesture("select");
    const card = store().reader.card;
    store().setPosition({ line: 0, phrase: 0, word: 2 });
    expect(store().reader.card).toBe(card);
  });

  it("gives a no-definition card for a word that cannot be defined, rather than a stale one", () => {
    useReaderStore.setState((s) => ({
      page: {
        ...s.page,
        lines: s.page.lines.map((l, i) =>
          i === 0 && l.words
            ? { ...l, words: l.words.map((w, j) => (j === 1 ? { ...w, text: "x7" } : w)) }
            : l,
        ),
      },
    }));
    store().setPosition({ line: 0, phrase: 0, word: 2 });
    store().applyGesture("select");
    store().setPosition({ line: 0, phrase: 0, word: 1 });
    expect(store().reader.card).toMatchObject({ problem: "not-found" });
  });

  it("closes the card when the finger moves on to somewhere with no word", () => {
    store().setPosition({ line: 0, phrase: 0, word: 2 });
    store().applyGesture("select");
    store().setPosition({ line: 1, phrase: 0 });
    expect(store().reader).toMatchObject({ view: "phrase" });
    expect(store().reader.card).toBeUndefined();
  });

  it("does nothing special without a card: the pointed word just changes", () => {
    store().setPosition({ line: 0, phrase: 0, word: 2 });
    store().setPosition({ line: 0, phrase: 0, word: 1 });
    expect(store().reader).toMatchObject({ view: "phrase", position: { word: 1 } });
    expect(store().reader.card).toBeUndefined();
  });

  it("shows the new word on the glasses display", async () => {
    const adapter = new WebSimulatorAdapter({ keyTarget: new EventTarget(), startDelayMs: 0 });
    adapter.setMaxUpdatesPerSecond(20);
    await adapter.session.start();
    store().setPosition({ line: 0, phrase: 0, word: 2 });
    store().applyGesture("select");
    renderReader(adapter, store().page, store().reader);
    expect(adapter.store.getState().item).toMatchObject({ kind: "word", word: "lighthouse" });
    store().setPosition({ line: 0, phrase: 0, word: 1 });
    renderReader(adapter, store().page, store().reader);
    expect(adapter.store.getState().item).toMatchObject({ kind: "word", word: "old" });
    adapter.dispose();
  });
});
