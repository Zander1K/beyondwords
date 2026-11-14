import { describe, expect, it, vi } from "vitest";

import type { Gesture } from "../adapter";
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
    ["ArrowRight", "next"],
    ["ArrowLeft", "prev"],
    ["Enter", "select"],
    ["Escape", "dismiss"],
  ] as const)("maps %s to %s", (key, gesture) => {
    expect(keyToGesture({ key })).toBe(gesture);
  });

  it("ignores other keys, modifier combos, key repeats and form fields", () => {
    expect(keyToGesture({ key: "a" })).toBeNull();
    expect(keyToGesture({ key: "ArrowRight", metaKey: true })).toBeNull();
    expect(keyToGesture({ key: "ArrowLeft", altKey: true })).toBeNull();
    expect(keyToGesture({ key: "Enter", repeat: true })).toBeNull();
    expect(keyToGesture({ key: "ArrowRight", target: { tagName: "INPUT" } })).toBeNull();
    expect(keyToGesture({ key: "Enter", target: { isContentEditable: true } })).toBeNull();
    // Enter on a focused button activates the button, not a second "select" gesture.
    expect(keyToGesture({ key: "Enter", target: { tagName: "BUTTON" } })).toBeNull();
    expect(keyToGesture({ key: "ArrowRight", target: { tagName: "BUTTON" } })).toBe("next");
  });
});

describe("WebSimulatorAdapter.onGesture", () => {
  it("delivers key presses and on-screen buttons as gestures", () => {
    const target = new EventTarget();
    const adapter = new WebSimulatorAdapter({ keyTarget: target });
    const seen: Gesture[] = [];
    adapter.onGesture((g) => seen.push(g));

    const handled = pressKey(target, "ArrowRight");
    pressKey(target, "ArrowLeft");
    pressKey(target, "Enter");
    pressKey(target, "Escape");
    const ignored = pressKey(target, "x");
    adapter.emitGesture("next");

    expect(seen).toEqual(["next", "prev", "select", "dismiss", "next"]);
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
