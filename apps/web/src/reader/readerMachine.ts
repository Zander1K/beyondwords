// Reader state machine: which phrase is current and what the glasses should show.
// Phrase-level, not word-by-word (CLAUDE.md section 8). No React, no browser APIs.
// TODO(alex): build order step 3-4: drive this from page JSON and finger tracking instead of
// demo phrases and gestures; add pacing and fading support.
import type { Gesture } from "@/glasses";

/** The gestures that move through the text. */
export type NavGesture = Extract<Gesture, "next" | "prev" | "select" | "dismiss">;

export function isNavGesture(g: Gesture): g is NavGesture {
  return g === "next" || g === "prev" || g === "select" || g === "dismiss";
}

export type ReaderView = "phrase" | "word" | "cleared";

export interface ReaderState {
  index: number;
  view: ReaderView;
}

export interface ReaderStep {
  state: ReaderState;
  /** What happened, so the UI can pick a cue (audio-only) and decide what to show. */
  outcome: "moved" | "word" | "cleared" | "restored" | "boundary" | "no-word";
}

export const initialReaderState: ReaderState = { index: 0, view: "phrase" };

/**
 * Apply a gesture. `phraseCount` is the number of phrases; `hasWord(i)` says whether phrase i has
 * a hard word to explain.
 */
export function readerStep(
  state: ReaderState,
  gesture: NavGesture,
  phraseCount: number,
  hasWord: (index: number) => boolean,
): ReaderStep {
  const last = phraseCount - 1;
  switch (gesture) {
    case "next":
    case "prev": {
      const index = state.index + (gesture === "next" ? 1 : -1);
      if (index < 0 || index > last) return { state, outcome: "boundary" };
      return { state: { index, view: "phrase" }, outcome: "moved" };
    }
    case "select":
      if (state.view === "cleared") {
        return { state: { ...state, view: "phrase" }, outcome: "restored" };
      }
      if (!hasWord(state.index)) return { state, outcome: "no-word" };
      return { state: { ...state, view: "word" }, outcome: "word" };
    case "dismiss":
      // Dismissing a word card goes back to the phrase; dismissing the phrase clears the display.
      if (state.view === "word")
        return { state: { ...state, view: "phrase" }, outcome: "restored" };
      return { state: { ...state, view: "cleared" }, outcome: "cleared" };
  }
}
