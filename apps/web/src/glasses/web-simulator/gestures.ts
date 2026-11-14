// Simulated hardware inputs of Meta glasses + Meta Neural Band, and what each one means for our
// app. Keys and on-screen buttons stand in for the physical controls.
//
// Only inputs relevant to reading are simulated (no video recording, calls or music).
// OPEN QUESTION: exact Neural Band gesture set and which of them DAT forwards to third-party
// apps. The gesture names below follow Meta's public descriptions (index pinch = select, middle
// pinch = back, thumb swipe = scroll, pinch-and-twist = volume) and must be confirmed.
// OPEN QUESTION: whether touchpad taps and the capture button reach our app on real glasses, or
// stay reserved for Meta AI / the system camera.
import type { Gesture } from "../adapter";

export type DeviceInput =
  // Meta Neural Band (wrist, EMG)
  | "band-index-pinch"
  | "band-middle-pinch"
  | "band-swipe-forward"
  | "band-swipe-back"
  | "band-twist-up"
  | "band-twist-down"
  // Temple touchpad (right arm of the glasses)
  | "touchpad-tap"
  | "touchpad-swipe-forward"
  | "touchpad-swipe-back"
  | "touchpad-hold"
  // Capture button (top of the right arm)
  | "capture-press";

/** What an input does: an app intent, or a volume change the glasses handle themselves. */
export type InputAction = { kind: "gesture"; gesture: Gesture } | { kind: "volume"; delta: number };

const VOLUME_STEP = 0.1;

export const INPUT_ACTIONS: Readonly<Record<DeviceInput, InputAction>> = {
  "band-index-pinch": { kind: "gesture", gesture: "select" },
  "band-middle-pinch": { kind: "gesture", gesture: "dismiss" },
  "band-swipe-forward": { kind: "gesture", gesture: "next" },
  "band-swipe-back": { kind: "gesture", gesture: "prev" },
  "band-twist-up": { kind: "volume", delta: VOLUME_STEP },
  "band-twist-down": { kind: "volume", delta: -VOLUME_STEP },
  "touchpad-tap": { kind: "gesture", gesture: "play-pause" },
  "touchpad-swipe-forward": { kind: "volume", delta: VOLUME_STEP },
  "touchpad-swipe-back": { kind: "volume", delta: -VOLUME_STEP },
  // On real glasses tap-and-hold wakes Meta AI; in our app it is push-to-talk.
  "touchpad-hold": { kind: "gesture", gesture: "assistant" },
  "capture-press": { kind: "gesture", gesture: "capture" },
};

/** Keyboard stand-ins for the hardware inputs. */
export const KEY_TO_INPUT: Readonly<Record<string, DeviceInput>> = {
  ArrowRight: "band-swipe-forward",
  ArrowLeft: "band-swipe-back",
  Enter: "band-index-pinch",
  Escape: "band-middle-pinch",
  "+": "band-twist-up",
  "=": "band-twist-up",
  "-": "band-twist-down",
  " ": "touchpad-tap",
  v: "touchpad-hold",
  c: "capture-press",
};

/** Labels for the simulator panel and docs. */
export const INPUT_LABELS: Readonly<Record<DeviceInput, { label: string; key: string }>> = {
  "band-swipe-back": { label: "Swipe back", key: "←" },
  "band-index-pinch": { label: "Index pinch", key: "Enter" },
  "band-swipe-forward": { label: "Swipe forward", key: "→" },
  "band-middle-pinch": { label: "Middle pinch", key: "Esc" },
  "band-twist-down": { label: "Twist −", key: "-" },
  "band-twist-up": { label: "Twist +", key: "+" },
  "touchpad-tap": { label: "Tap", key: "Space" },
  "touchpad-swipe-back": { label: "Swipe back", key: "" },
  "touchpad-swipe-forward": { label: "Swipe forward", key: "" },
  "touchpad-hold": { label: "Hold", key: "V" },
  "capture-press": { label: "Capture", key: "C" },
};

/** The parts of a KeyboardEvent the mapping needs (keeps it testable without a DOM). */
export interface KeyLike {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
  target?: unknown;
}

function tagOf(target: unknown): unknown {
  if (typeof target !== "object" || target === null) return undefined;
  return (target as { tagName?: unknown }).tagName;
}

function isEditable(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false;
  if ((target as { isContentEditable?: unknown }).isContentEditable === true) return true;
  const tag = tagOf(target);
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Map a key press to a hardware input, or null. Ignored: modifier combos (browser shortcuts),
 * held-down key repeats, typing in form fields, and Enter/Space on a focused button or link
 * (they activate that control instead, so one press is not two actions).
 */
export function keyToInput(event: KeyLike): DeviceInput | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return null;
  if (isEditable(event.target)) return null;
  const tag = tagOf(event.target);
  if ((event.key === "Enter" || event.key === " ") && (tag === "BUTTON" || tag === "A")) {
    return null;
  }
  return KEY_TO_INPUT[event.key.length === 1 ? event.key.toLowerCase() : event.key] ?? null;
}

/** Convenience for tests and docs: the app intent a key produces, if any. */
export function keyToGesture(event: KeyLike): Gesture | null {
  const input = keyToInput(event);
  if (!input) return null;
  const action = INPUT_ACTIONS[input];
  return action.kind === "gesture" ? action.gesture : null;
}
