// Keyboard stand-ins for the six abstract glasses actions (SIMULATION_FEATURES.md section 2.5).
//
// | Real gesture            | Action  | Key        |
// | Thumb-index pinch       | select  | Enter      |
// | Thumb-middle pinch      | back    | Escape     |
// | Thumb swipe right/left  | right/left | ArrowRight / ArrowLeft |
// | Thumb swipe down/up     | down/up | ArrowDown / ArrowUp |
// The frame touchpad delivers the same actions (on-screen touchpad buttons in the panel).
import type { GlassesGesture } from "../adapter";

export const KEY_TO_GESTURE: Readonly<Record<string, GlassesGesture>> = {
  Enter: "select",
  Escape: "back",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

export const GESTURE_KEYS: Readonly<Record<GlassesGesture, string>> = {
  select: "Enter",
  back: "Esc",
  left: "←",
  right: "→",
  up: "↑",
  down: "↓",
};

/** Where a gesture came from, for the gesture log. */
export type GestureSource = "key" | "band" | "touchpad";

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
 * Map a key press to a glasses action, or null. Ignored: modifier combos (browser shortcuts),
 * held-down key repeats, typing in form fields, and Enter on a focused button or link (it
 * activates that control instead, so one press is not two actions).
 */
export function keyToGesture(event: KeyLike): GlassesGesture | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return null;
  if (isEditable(event.target)) return null;
  const tag = tagOf(event.target);
  if (event.key === "Enter" && (tag === "BUTTON" || tag === "A")) return null;
  return KEY_TO_GESTURE[event.key] ?? null;
}
