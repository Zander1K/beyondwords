// Keyboard shortcuts for the simulator's own UI (not glasses gestures; see gestures.ts). Raw key
// listeners live in the web simulator only (ESLint enforces it).
import { isControlsShortcut } from "./gestures";

/** Calls `handler` when the controls shortcut (C) is pressed. Returns an unsubscribe function. */
export function listenForControlsShortcut(handler: () => void): () => void {
  const onKey = (event: KeyboardEvent) => {
    if (isControlsShortcut(event)) handler();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
