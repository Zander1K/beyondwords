// Reader state (Zustand). SIM-SES-07: the phone is the source of truth. Page, position, view and
// the app's view of the glasses session live here, never in the adapter or the panel, so the
// adapter can be torn down and recreated without losing the reading position.
import { create } from "zustand";

import type { GlassesGesture, SessionState } from "@/glasses";
import { defineWord } from "@/api";
import {
  type Box,
  currentPhrase,
  DEMO_PAGE,
  mapPosition,
  mergePages,
  initialReaderState,
  moveToLine,
  type Page,
  readerStep,
  type ReaderPosition,
  type ReaderState,
  type ReaderStep,
} from "@/reader";

/** State of the live page reading (camera frames -> OCR -> page analysis). */
export type ScanState =
  | { status: "idle" }
  | { status: "scanning" }
  /** Continuous scanning of the live camera. */
  | { status: "live"; lines: number; ocrMs: number; scans: number; unwarped: boolean }
  | { status: "empty"; ocrMs: number }
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
  /**
   * A continuous-scan read. Merged into the current page (lines under the hand are kept); a
   * page turn starts over at the top. Returns whether it counted as a new page.
   */
  mergeScan: (next: Page, occluded: Box | null) => boolean;
  setSession: (session: SessionState) => void;
  setOffline: (offline: boolean) => void;
  setAsleep: (asleep: boolean) => void;
  setScan: (scan: ScanState) => void;
}

export const useReaderStore = create<ReaderStore>((set, get) => ({
  // HACK: demo page until the camera's first read replaces it.
  page: DEMO_PAGE,
  reader: initialReaderState,
  session: "stopped",
  offline: false,
  asleep: false,
  scan: { status: "idle" },
  handLost: false,
  applyGesture: (gesture) => {
    const page = get().page;
    let step = readerStep(page, get().reader, gesture);
    if (step.outcome === "card-opened") {
      // The word under the finger, else the phrase's hard word.
      const pos = step.state.position;
      const pointed = pos.word !== undefined ? page.lines[pos.line]?.words?.[pos.word] : undefined;
      const card = pointed ? defineWord(pointed.text) : currentPhrase(page, pos)?.hardWord?.card;
      step = { ...step, state: { ...step.state, card } };
    }
    if (step.state !== get().reader) set({ reader: step.state });
    return step;
  },
  goToLine: (line) => set((s) => ({ reader: moveToLine(s.page, s.reader, line) })),
  setPage: (page) => set({ page, reader: initialReaderState }),
  mergeScan: (next, occluded) => {
    const { page, reader } = get();
    const merged = mergePages(page, next, occluded, page.id === DEMO_PAGE.id);
    if (merged.newPage) {
      set({ page: merged.page, reader: initialReaderState });
      return true;
    }
    const position = mapPosition(page, merged.page, reader.position);
    const moved = position.line !== reader.position.line;
    set({
      page: merged.page,
      // Keep an open card unless its line disappeared; the next fingertip frame refines this.
      reader: moved
        ? { ...reader, position, view: "phrase", cardFocus: 0, card: undefined }
        : { ...reader, position: { ...position, word: reader.position.word } },
    });
    return false;
  },
  setSession: (session) => set({ session }),
  setOffline: (offline) => set({ offline }),
  setAsleep: (asleep) => set({ asleep }),
  setScan: (scan) => set({ scan }),
  setPosition: (position) =>
    set((s) => {
      const cur = s.reader.position;
      if (cur.line === position.line && cur.phrase === position.phrase) {
        // Same phrase: only the pointed word may change; an open card stays open.
        if (cur.word === position.word) return {};
        return { reader: { ...s.reader, position } };
      }
      // Pointing at another phrase closes a word card ([ASSUMPTION]: the finger moved on).
      return { reader: { ...s.reader, position, view: "phrase", cardFocus: 0, card: undefined } };
    }),
  setHandLost: (handLost) => set((s) => (s.handLost === handLost ? {} : { handLost })),
}));
