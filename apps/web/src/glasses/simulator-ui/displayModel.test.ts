import { describe, expect, it, vi } from "vitest";

import { WebSimulatorAdapter } from "../web-simulator/WebSimulatorAdapter";
import { DISPLAY_LIMITS, makePhrase, makeWordCard, normaliseText } from "./displayModel";
import { buildScene, type SceneNode } from "./scene";

const LONG =
  "The old lighthouse stood alone at the edge of the grey cliffs and every night its lamp swept slowly across the water";

const ALLOWED = new Set(["flex", "text", "image", "button", "icon"]);

function walk(node: SceneNode, visit: (n: SceneNode) => void): void {
  visit(node);
  if (node.type === "flex") for (const child of node.children) walk(child, visit);
}

describe("SIM-DSP-03 one thing at a time, length limits", () => {
  it("collapses newlines so no paragraph reaches the display", () => {
    expect(normaliseText("one\n\ntwo   three\tfour ")).toBe("one two three four");
    expect(makePhrase("first line\nsecond line")).toEqual({
      kind: "phrase",
      text: "first line second line",
    });
  });

  it("truncates phrases over 12 words and logs a warning", () => {
    const warn = vi.fn();
    const phrase = makePhrase(LONG, undefined, warn);
    if (phrase?.kind !== "phrase") throw new Error("expected a phrase");
    expect(phrase.text.slice(0, -1).split(" ")).toHaveLength(DISPLAY_LIMITS.phraseMaxWords);
    expect(phrase.text.endsWith("…")).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("truncates definitions over 25 words and logs a warning", () => {
    const warn = vi.fn();
    const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    const card = makeWordCard({ word: "lighthouse", short: long }, warn);
    if (card?.kind !== "word") throw new Error("expected a card");
    expect(card.short.slice(0, -1).split(" ")).toHaveLength(DISPLAY_LIMITS.definitionMaxWords);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("clamps emphasis to the visible text", () => {
    expect(makePhrase("The old lighthouse stood alone", [8, 18])).toEqual({
      kind: "phrase",
      text: "The old lighthouse stood alone",
      emphasis: [8, 18],
    });
    const offscreen = makePhrase(LONG, [100, 110]);
    expect(offscreen && "emphasis" in offscreen).toBe(false);
  });

  it("ignores empty content", () => {
    expect(makePhrase("   \n ")).toBeNull();
    expect(makeWordCard({ word: " ", short: "x" })).toBeNull();
  });
});

describe("SIM-DSP-01 component-limited scenes", () => {
  it("builds scenes only from FlexBox, Text, Image, Button and Icon", () => {
    const scenes = [
      buildScene({ kind: "phrase", text: "The old lighthouse", emphasis: [8, 18] }, "hand-lost"),
      buildScene(
        { kind: "word", word: "lamp", short: "A light.", actions: ["hear"], focused: "hear" },
        null,
      ),
      buildScene({ kind: "image", url: "https://example.test/a.png" }, null),
    ];
    for (const scene of scenes) {
      if (!scene) throw new Error("expected a scene");
      walk(scene, (n) => expect(ALLOWED.has(n.type)).toBe(true));
    }
    expect(buildScene(null, null)).toBeNull();
  });

  it("SIM-DSP-04 marks exactly the emphasised words in the phrase", () => {
    const scene = buildScene(
      { kind: "phrase", text: "The old lighthouse", emphasis: [8, 18] },
      null,
    );
    const texts: { text: string; tone?: string }[] = [];
    if (scene) walk(scene, (n) => n.type === "text" && texts.push(n));
    expect(texts.filter((t) => t.tone === "accent").map((t) => t.text)).toEqual(["lighthouse"]);
    expect(texts.map((t) => t.text).join(" ")).toBe("The old lighthouse");
  });

  it("SIM-DSP-05 word card: heading word, body definition, focused button", () => {
    const scene = buildScene(
      { kind: "word", word: "lamp", short: "A light.", actions: ["hear"], focused: "hear" },
      null,
    );
    const nodes: SceneNode[] = [];
    if (scene) walk(scene, (n) => nodes.push(n));
    expect(nodes).toContainEqual({ type: "text", preset: "heading", text: "lamp" });
    expect(nodes).toContainEqual({ type: "text", preset: "body", text: "A light." });
    expect(nodes).toContainEqual({ type: "button", label: "Hear it", focused: true });
  });
});

describe("simulated display", () => {
  it("replaces the previous item instead of stacking, with one optional status", async () => {
    const adapter = new WebSimulatorAdapter({ keyTarget: new EventTarget(), startDelayMs: 0 });
    adapter.setMaxUpdatesPerSecond(20);
    await adapter.session.start();
    adapter.showPhrase("The old lighthouse");
    adapter.showStatus("hand-lost");
    adapter.showWordCard({ word: "lighthouse", short: "A tower that guides ships." });
    expect(adapter.store.getState().item).toEqual({
      kind: "word",
      word: "lighthouse",
      short: "A tower that guides ships.",
      actions: [],
    });
    expect(adapter.store.getState().status).toBe("hand-lost");
    adapter.clearDisplay();
    expect(adapter.store.getState().item).toBeNull();
    adapter.dispose();
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
