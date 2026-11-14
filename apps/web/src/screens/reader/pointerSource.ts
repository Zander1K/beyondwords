// Who is pointing at the page in camera mode: the fingertip or the mouse cursor. They are
// interchangeable; "auto" follows whichever was used last (the mouse keeps control while it moves
// and for a moment after, then the finger takes over again).
import type { Point } from "@/vision";

export type PointerMode = "auto" | "finger" | "mouse";

/** In auto, the mouse keeps the pointer this long after it last moved. */
export const MOUSE_IDLE_MS = 1500;

/** Whether the mouse (rather than the finger) is the pointer right now. */
export function mouseIsPointer(mode: PointerMode, lastMouseMoveAt: number, now: number): boolean {
  if (mode === "mouse") return true;
  if (mode === "finger") return false;
  return now - lastMouseMoveAt < MOUSE_IDLE_MS;
}

/**
 * Map a mouse position to the camera image's 0-1 coordinates (the space hand and OCR boxes use).
 * `box` is the displayed image box. Null when the mouse is outside it.
 */
export function toImagePoint(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
): Point | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const x = (clientX - box.left) / box.width;
  const y = (clientY - box.top) / box.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

// Shared by the mouse hook and the hand-tracking loop (module state: one reader screen at a time).
let lastMouseMoveAt = Number.NEGATIVE_INFINITY;
export const pointerClock = {
  mouseMoved: (now: number) => {
    lastMouseMoveAt = now;
  },
  mouseLeft: () => {
    lastMouseMoveAt = Number.NEGATIVE_INFINITY;
  },
  mouseIsPointer: (mode: PointerMode, now: number) => mouseIsPointer(mode, lastMouseMoveAt, now),
};
