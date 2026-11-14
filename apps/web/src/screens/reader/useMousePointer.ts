// The mouse cursor as the reading pointer in camera mode, interchangeable with the fingertip.
// Hover moves the highlight like the fingertip does; click opens the word's card (click the open
// word again, or right-click, to close it). Which of the two points is the Pointer setting.
import { useCallback, useRef } from "react";

import { type GlassesGesture, useNoteActivity } from "@/glasses";
import { useReaderStore, useSettings } from "@/state";
import {
  initialPickerState,
  MOUSE_THRESHOLDS,
  pickLine,
  type PickerState,
  type Point,
} from "@/vision";

import { pointerClock } from "./pointerSource";

export function useMousePointer(onGesture: (gesture: GlassesGesture) => void) {
  const picker = useRef<PickerState>(initialPickerState);
  const noteActivity = useNoteActivity();

  const allowed = () => useSettings.getState().pointer !== "finger";

  const point = useCallback((tip: Point, hoverOnly: boolean) => {
    const s = useReaderStore.getState();
    if (!s.page.lines.some((l) => l.baseline)) return;
    // With a card open, hovering must not look up every word the mouse passes.
    if (hoverOnly && s.reader.view === "card") return;
    picker.current = pickLine(s.page, tip, picker.current, MOUSE_THRESHOLDS);
    const next = picker.current.position;
    const at = s.reader.position;
    if (next && (next.line !== at.line || next.word !== at.word || next.phrase !== at.phrase)) {
      s.setPosition(next);
    }
  }, []);

  return {
    onMove: (tip: Point) => {
      if (!allowed()) return;
      pointerClock.mouseMoved(performance.now());
      noteActivity();
      point(tip, true);
    },
    onLeave: () => pointerClock.mouseLeft(),
    onClick: (tip: Point) => {
      if (!allowed()) return;
      pointerClock.mouseMoved(performance.now());
      noteActivity();
      const before = useReaderStore.getState().reader.position;
      const wasCard = useReaderStore.getState().reader.view === "card";
      point(tip, false);
      const s = useReaderStore.getState();
      const at = s.reader.position;
      if (wasCard && at.line === before.line && at.word === before.word) onGesture("back");
      else if (at.word !== undefined && s.reader.view !== "card") onGesture("select");
    },
    onBack: () => {
      if (allowed()) onGesture("back");
    },
    reset: () => {
      picker.current = initialPickerState;
    },
  };
}
