// "The user is doing something": keeps the simulated display awake (and wakes it if it dozed off).
// The display's idle timer is reset by glasses gestures (keys, pad, pinches), but the ebook is
// used with the mouse, which is not a glasses gesture: without this the display would dim and
// sleep after the idle timeout (30 s by default) while the reader is hovering and clicking.
// A real display reads this from the Neural Band; only the simulator needs the nudge.
import { useCallback, useRef } from "react";

import { useGlasses } from "./context";
import { WebSimulatorAdapter } from "./web-simulator/WebSimulatorAdapter";

/** Nudge no more often than this; hovering fires many events. */
const MIN_GAP_MS = 1000;

export function useNoteActivity(): () => void {
  const adapter = useGlasses();
  const last = useRef(0);
  return useCallback(() => {
    const now = Date.now();
    if (now - last.current < MIN_GAP_MS) return;
    last.current = now;
    if (adapter instanceof WebSimulatorAdapter) adapter.wake();
  }, [adapter]);
}
