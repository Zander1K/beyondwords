import { describe, expect, it } from "vitest";

import { WebSimulatorAdapter } from "../web-simulator/WebSimulatorAdapter";
import { DISPLAY_LIMITS, makePhrase, makeWordCard, normaliseText, truncate } from "./displayModel";
import { INITIAL_DEVICE, isDisplayOn } from "./simulatorStore";

const LONG =
  "The old lighthouse stood alone at the edge of the grey cliffs and every night its lamp swept slowly across the water";

describe("display constraints", () => {
  it("collapses newlines and repeated spaces so no paragraph reaches the display", () => {
    expect(normaliseText("one\n\ntwo   three\tfour ")).toBe("one two three four");
    const phrase = makePhrase("first line\nsecond line");
    expect(phrase).toEqual({ kind: "phrase", text: "first line second line" });
  });

  it("cuts long phrases at a word boundary with an ellipsis", () => {
    const phrase = makePhrase(LONG);
    expect(phrase?.kind).toBe("phrase");
    if (phrase?.kind !== "phrase") return;
    expect(phrase.text.length).toBeLessThanOrEqual(DISPLAY_LIMITS.phraseMaxChars);
    expect(phrase.text.endsWith("…")).toBe(true);
    expect(phrase.text).not.toMatch(/\s…$/);
    expect(LONG.startsWith(phrase.text.slice(0, -1))).toBe(true);
  });

  it("leaves short text untouched", () => {
    expect(truncate("short", 10)).toBe("short");
  });

  it("clamps emphasis to the visible text and drops it when it falls off the end", () => {
    const kept = makePhrase("The old lighthouse stood alone", [8, 18]);
    expect(kept).toEqual({
      kind: "phrase",
      text: "The old lighthouse stood alone",
      emphasis: [8, 18],
    });

    const offscreen = makePhrase(LONG, [100, 110]);
    expect(offscreen && "emphasis" in offscreen).toBe(false);
  });

  it("limits word cards to a short word and a one-line definition", () => {
    const card = makeWordCard({ word: "lighthouse", short: LONG });
    expect(card?.kind).toBe("word");
    if (card?.kind !== "word") return;
    expect(card.short.length).toBeLessThanOrEqual(DISPLAY_LIMITS.shortMaxChars);
  });

  it("ignores empty content", () => {
    expect(makePhrase("   \n ")).toBeNull();
    expect(makeWordCard({ word: " ", short: "x" })).toBeNull();
  });
});

describe("simulated display shows one item at a time", () => {
  it("replaces the previous item instead of stacking", () => {
    const adapter = new WebSimulatorAdapter({ keyTarget: new EventTarget() });
    adapter.showPhrase("The old lighthouse");
    adapter.showWordCard({ word: "lighthouse", short: "A tower that guides ships." });
    expect(adapter.store.getState().content).toEqual({
      kind: "word",
      word: "lighthouse",
      short: "A tower that guides ships.",
    });
    adapter.showImage("https://example.test/picture.png");
    expect(adapter.store.getState().content?.kind).toBe("image");
    adapter.showViewfinder();
    expect(adapter.store.getState().content).toEqual({ kind: "viewfinder" });
    adapter.clearDisplay();
    expect(adapter.store.getState().content).toBeNull();
    adapter.dispose();
  });

  it("turns the display off when the glasses are not worn, folded or disconnected", () => {
    const on = { audioOnly: false, device: { ...INITIAL_DEVICE } };
    expect(isDisplayOn(on)).toBe(true);
    expect(isDisplayOn({ ...on, audioOnly: true })).toBe(false);
    expect(isDisplayOn({ ...on, device: { ...on.device, worn: false } })).toBe(false);
    expect(isDisplayOn({ ...on, device: { ...on.device, folded: true } })).toBe(false);
    expect(isDisplayOn({ ...on, device: { ...on.device, connected: false } })).toBe(false);
  });

  it("reports no display in audio-only mode", () => {
    const adapter = new WebSimulatorAdapter({ keyTarget: new EventTarget() });
    expect(adapter.capabilities.display).toBe(true);
    expect(adapter.capabilities.displaySize).toEqual({ w: 600, h: 600 });
    adapter.setAudioOnly(true);
    expect(adapter.capabilities.display).toBe(false);
    expect(adapter.capabilities.displaySize).toBeUndefined();
    adapter.dispose();
  });
});
