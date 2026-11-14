import { describe, expect, it, vi } from "vitest";

import type { Gesture, GlassesState } from "../adapter";
import { INPUT_ACTIONS, keyToGesture, keyToInput } from "./gestures";
import { WebSimulatorAdapter } from "./WebSimulatorAdapter";

function pressKey(target: EventTarget, key: string, extra: Record<string, unknown> = {}): Event {
  // Node has no KeyboardEvent; a plain cancelable Event with the same fields is enough.
  const event = Object.assign(new Event("keydown", { cancelable: true }), { key, ...extra });
  target.dispatchEvent(event);
  return event;
}

function makeAdapter() {
  const target = new EventTarget();
  return { target, adapter: new WebSimulatorAdapter({ keyTarget: target }) };
}

describe("key and hardware input mapping", () => {
  it.each([
    ["ArrowRight", "next"],
    ["ArrowLeft", "prev"],
    ["Enter", "select"],
    ["Escape", "dismiss"],
    [" ", "play-pause"],
    ["c", "capture"],
    ["C", "capture"],
    ["v", "assistant"],
  ] as const)("key %j means %s", (key, gesture) => {
    expect(keyToGesture({ key })).toBe(gesture);
  });

  it("maps Neural Band twists and touchpad swipes to volume, not app gestures", () => {
    expect(keyToInput({ key: "+" })).toBe("band-twist-up");
    expect(keyToGesture({ key: "+" })).toBeNull();
    expect(INPUT_ACTIONS["touchpad-swipe-forward"]).toEqual({ kind: "volume", delta: 0.1 });
    expect(INPUT_ACTIONS["band-twist-down"]).toEqual({ kind: "volume", delta: -0.1 });
  });

  it("ignores other keys, modifier combos, key repeats and form fields", () => {
    expect(keyToGesture({ key: "a" })).toBeNull();
    expect(keyToGesture({ key: "ArrowRight", metaKey: true })).toBeNull();
    expect(keyToGesture({ key: "c", ctrlKey: true })).toBeNull();
    expect(keyToGesture({ key: "Enter", repeat: true })).toBeNull();
    expect(keyToGesture({ key: "ArrowRight", target: { tagName: "INPUT" } })).toBeNull();
    expect(keyToGesture({ key: "c", target: { tagName: "INPUT" } })).toBeNull();
    expect(keyToGesture({ key: "Enter", target: { isContentEditable: true } })).toBeNull();
  });

  it("leaves Enter and Space to a focused button", () => {
    expect(keyToGesture({ key: "Enter", target: { tagName: "BUTTON" } })).toBeNull();
    expect(keyToGesture({ key: " ", target: { tagName: "BUTTON" } })).toBeNull();
    expect(keyToGesture({ key: "ArrowRight", target: { tagName: "BUTTON" } })).toBe("next");
  });
});

describe("WebSimulatorAdapter gestures", () => {
  it("delivers key presses and on-screen buttons as gestures", () => {
    const { target, adapter } = makeAdapter();
    const seen: Gesture[] = [];
    adapter.onGesture((g) => seen.push(g));

    const handled = pressKey(target, "ArrowRight");
    pressKey(target, "ArrowLeft");
    pressKey(target, "Enter");
    pressKey(target, "Escape");
    pressKey(target, "c");
    const ignored = pressKey(target, "x");
    adapter.press("touchpad-tap");
    adapter.press("touchpad-hold");

    expect(seen).toEqual([
      "next",
      "prev",
      "select",
      "dismiss",
      "capture",
      "play-pause",
      "assistant",
    ]);
    expect(handled.defaultPrevented).toBe(true);
    expect(ignored.defaultPrevented).toBe(false);
    adapter.dispose();
  });

  it("handles volume on the device and clamps it", () => {
    const { adapter } = makeAdapter();
    const gestures = vi.fn();
    adapter.onGesture(gestures);
    const start = adapter.state.volume;
    adapter.press("band-twist-up");
    expect(adapter.state.volume).toBeCloseTo(start + 0.1);
    for (let i = 0; i < 20; i++) adapter.press("touchpad-swipe-back");
    expect(adapter.state.volume).toBe(0);
    expect(gestures).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("stops listening after unsubscribe and after dispose", () => {
    const { target, adapter } = makeAdapter();
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

describe("WebSimulatorAdapter device state", () => {
  it("ignores all input while disconnected", () => {
    const { target, adapter } = makeAdapter();
    const seen = vi.fn();
    adapter.onGesture(seen);
    adapter.setDevice({ connected: false });
    pressKey(target, "ArrowRight");
    adapter.press("capture-press");
    expect(seen).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("reports state changes and disconnects at 0% battery", () => {
    const { adapter } = makeAdapter();
    const states: GlassesState[] = [];
    adapter.onStateChange((s) => states.push(s));
    adapter.setDevice({ worn: false });
    adapter.setDevice({ battery: 0 });
    expect(states.map((s) => s.worn)).toEqual([false, false]);
    expect(adapter.state).toMatchObject({ battery: 0, connected: false });
    adapter.dispose();
  });

  it("refuses the camera when folded or disconnected, and capture without a camera", async () => {
    const { adapter } = makeAdapter();
    adapter.setDevice({ folded: true });
    await expect(adapter.startCamera()).rejects.toMatchObject({ code: "glasses-unavailable" });
    adapter.setDevice({ folded: false, connected: false });
    await expect(adapter.startCamera()).rejects.toMatchObject({ code: "glasses-unavailable" });
    await expect(adapter.capturePhoto()).rejects.toMatchObject({ code: "camera-off" });
    adapter.dispose();
  });
});

describe("WebSimulatorAdapter voice", () => {
  it("sends typed commands to utterance listeners", () => {
    const { adapter } = makeAdapter();
    const heard = vi.fn();
    adapter.onUtterance(heard);
    adapter.simulateUtterance("  next line ");
    adapter.simulateUtterance("   ");
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith("next line");
    adapter.dispose();
  });

  it("resolves push-to-talk with a typed command when there is no speech recognition", async () => {
    const { adapter } = makeAdapter();
    const heard = vi.fn();
    adapter.onUtterance(heard);
    const listening = adapter.listen();
    expect(adapter.store.getState().listening).toBe(true);
    adapter.simulateUtterance("what does lamp mean");
    await expect(listening).resolves.toBe("what does lamp mean");
    // Answered push-to-talk, so it is not also broadcast.
    expect(heard).not.toHaveBeenCalled();
    expect(adapter.store.getState().listening).toBe(false);
    adapter.dispose();
  });
});
