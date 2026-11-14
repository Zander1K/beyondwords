import { describe, expect, it, vi } from "vitest";

import type { GlassesGesture } from "../adapter";
import { keyToGesture } from "./gestures";
import { WebSimulatorAdapter } from "./WebSimulatorAdapter";

function pressKey(target: EventTarget, key: string, extra: Record<string, unknown> = {}): Event {
  // Node has no KeyboardEvent; a plain cancelable Event with the same fields is enough.
  const event = Object.assign(new Event("keydown", { cancelable: true }), { key, ...extra });
  target.dispatchEvent(event);
  return event;
}

describe("keyToGesture", () => {
  it.each([
    ["Enter", "select"],
    ["Escape", "back"],
    ["ArrowLeft", "left"],
    ["ArrowRight", "right"],
    ["ArrowUp", "up"],
    ["ArrowDown", "down"],
  ] as const)("maps %s to %s", (key, gesture) => {
    expect(keyToGesture({ key })).toBe(gesture);
  });

  it("ignores other keys, modifier combos, key repeats and form fields", () => {
    expect(keyToGesture({ key: "a" })).toBeNull();
    expect(keyToGesture({ key: " " })).toBeNull();
    expect(keyToGesture({ key: "ArrowRight", metaKey: true })).toBeNull();
    expect(keyToGesture({ key: "Enter", repeat: true })).toBeNull();
    expect(keyToGesture({ key: "ArrowDown", target: { tagName: "INPUT" } })).toBeNull();
    expect(keyToGesture({ key: "Enter", target: { isContentEditable: true } })).toBeNull();
    expect(keyToGesture({ key: "Enter", target: { tagName: "BUTTON" } })).toBeNull();
    expect(keyToGesture({ key: "ArrowRight", target: { tagName: "BUTTON" } })).toBe("right");
  });
});

describe("WebSimulatorAdapter.onGesture", () => {
  it("delivers keys and pad buttons as the six actions", () => {
    const target = new EventTarget();
    const adapter = new WebSimulatorAdapter({ keyTarget: target });
    const seen: GlassesGesture[] = [];
    adapter.onGesture((g) => seen.push(g));

    const handled = pressKey(target, "ArrowDown");
    pressKey(target, "ArrowUp");
    pressKey(target, "Enter");
    pressKey(target, "Escape");
    const ignored = pressKey(target, "x");
    adapter.emitGesture("left");

    expect(seen).toEqual(["down", "up", "select", "back", "left"]);
    expect(handled.defaultPrevented).toBe(true);
    expect(ignored.defaultPrevented).toBe(false);
    adapter.dispose();
  });

  it("stops listening after unsubscribe and after dispose", () => {
    const target = new EventTarget();
    const adapter = new WebSimulatorAdapter({ keyTarget: target });
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = adapter.onGesture(first);
    adapter.onGesture(second);
    unsubscribe();
    pressKey(target, "Enter");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("select");
    adapter.dispose();
    pressKey(target, "Enter");
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("WebSimulatorAdapter session", () => {
  it("runs stopped -> starting -> started -> stopping -> stopped", async () => {
    const adapter = new WebSimulatorAdapter({
      keyTarget: new EventTarget(),
      startDelayMs: 0,
      stopDelayMs: 0,
    });
    const states: string[] = [];
    adapter.store.subscribe((s, prev) => {
      if (s.session !== prev.session) states.push(s.session);
    });
    await adapter.session.start();
    await adapter.session.stop();
    expect(states).toEqual(["starting", "started", "stopping", "stopped"]);
    adapter.dispose();
  });

  it("ignores and logs display calls outside a started session", () => {
    const warn = vi.fn();
    const adapter = new WebSimulatorAdapter({ keyTarget: new EventTarget(), warn });
    adapter.showPhrase("hello");
    expect(adapter.store.getState().item).toBeNull();
    expect(warn).toHaveBeenCalledWith("showPhrase ignored: session is stopped");
    adapter.dispose();
  });
});
