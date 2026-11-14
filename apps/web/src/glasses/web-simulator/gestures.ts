// Keyboard stand-ins for Neural Band gestures.
import type { Gesture } from "../adapter";

export const KEY_TO_GESTURE: Readonly<Record<string, Gesture>> = {
  ArrowRight: "next",
  ArrowLeft: "prev",
  Enter: "select",
  Escape: "dismiss",
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

function isEditable(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

function isActivatable(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false;
  const tag = (target as { tagName?: unknown }).tagName;
  return tag === "BUTTON" || tag === "A";
}

/**
 * Map a key press to a gesture, or null. Ignored: modifier combos (browser shortcuts), held-down
 * key repeats, typing in form fields (so Settings sliders keep their arrow keys), and Enter on a
 * focused button or link (it activates that control instead, so one press is not two actions).
 */
export function keyToGesture(event: KeyLike): Gesture | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return null;
  if (isEditable(event.target)) return null;
  if (event.key === "Enter" && isActivatable(event.target)) return null;
  return KEY_TO_GESTURE[event.key] ?? null;
}
