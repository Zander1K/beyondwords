// Reader state (Zustand). SIM-SES-07: the phone is the source of truth. Page, position, view and
// the app's view of the glasses session live here, never in the adapter or the panel, so the
// adapter can be torn down and recreated without losing the reading position.
import { create } from "zustand";

import type { GlassesGesture, SessionState } from "@/glasses";
import {
  DEMO_PAGE,
  initialReaderState,
  moveToLine,
  type Page,
  readerStep,
  type ReaderPosition,
  type ReaderState,
  type ReaderStep,
} from "@/reader";

/** State of the page scan (camera still or upload -> OCR -> page analysis). */
export type ScanState =
  | { status: "idle" }
  | { status: "scanning"; source: "camera" | "upload" }
  | { status: "ready"; source: "camera" | "upload"; lines: number; ocrMs: number }
  | { status: "empty"; source: "camera" | "upload"; ocrMs: number }
  | { status: "error"; message: string };

export interface ReaderStore {
  page: Page;
  reader: ReaderState;
  /** The session as the app last saw it (from start/stop calls and session events). */
  session: SessionState;
  /** Glasses link lost: reading continues on the phone screen. */
  offline: boolean;
  /** The display is asleep: nothing to send until it wakes. */
  asleep: boolean;
  scan: ScanState;
  /** No pointing hand seen for the hand-lost timeout (SIM-VIS-04). */
  handLost: boolean;
  /** Apply a glasses gesture; returns what happened so the caller can give feedback. */
  applyGesture: (gesture: GlassesGesture) => ReaderStep;
  goToLine: (line: number) => void;
  /** Finger tracking put the reader here. Closes the word card if the line changes. */
  setPosition: (position: ReaderPosition) => void;
  setHandLost: (lost: boolean) => void;
  setPage: (page: Page) => void;
  setSession: (session: SessionState) => void;
  setOffline: (offline: boolean) => void;
  setAsleep: (asleep: boolean) => void;
  setScan: (scan: ScanState) => void;
}

export const useReaderStore = create<ReaderStore>((set, get) => ({
  // HACK: demo page until page capture -> /pages/analyze exists.
  page: DEMO_PAGE,
  reader: initialReaderState,
  session: "stopped",
  offline: false,
  asleep: false,
  scan: { status: "idle" },
  handLost: false,
  applyGesture: (gesture) => {
    const step = readerStep(get().page, get().reader, gesture);
    if (step.state !== get().reader) set({ reader: step.state });
    return step;
  },
  goToLine: (line) => set((s) => ({ reader: moveToLine(s.page, s.reader, line) })),
  setPage: (page) => set({ page, reader: initialReaderState }),
  setSession: (session) => set({ session }),
  setOffline: (offline) => set({ offline }),
  setAsleep: (asleep) => set({ asleep }),
  setScan: (scan) => set({ scan }),
  setPosition: (position) =>
    set((s) => {
      const cur = s.reader.position;
      if (cur.line === position.line && cur.phrase === position.phrase) return {};
      // Pointing at another phrase closes a word card ([ASSUMPTION]: the finger moved on).
      return { reader: { ...s.reader, position, view: "phrase", cardFocus: 0 } };
    }),
  setHandLost: (handLost) => set((s) => (s.handLost === handLost ? {} : { handLost })),
}));
