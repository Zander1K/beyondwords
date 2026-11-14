// Reader state machine: where the reader is on the page and what the glasses show.
// Phrase-level, not word-by-word (CLAUDE.md section 8). No React, no browser APIs.
//
// Gestures (SIMULATION_FEATURES.md section 2.5):
//   right / left  next / previous phrase (crossing lines)
//   down / up     next / previous line (first phrase)
//   select        open the word card; on a card, activate the focused action
//   back          close the card. Back on the root screen ending the session is P1 (not built).
import type { GlassesGesture, WordCard, WordCardAction } from "@/glasses";

import type { Page } from "./page";

export type ReaderView = "phrase" | "card";

export interface ReaderPosition {
  line: number;
  phrase: number;
  /** The word the fingertip points at (index into the line's words), if known. */
  word?: number;
}

export interface ReaderState {
  position: ReaderPosition;
  view: ReaderView;
  /** Focused word-card action while the card is open. */
  cardFocus: number;
  /** The word card being shown (the pointed word, or the phrase's hard word). */
  card?: WordCard;
}

export type ReaderOutcome =
  | "moved"
  | "boundary"
  | "card-opened"
  | "card-closed"
  | "card-focus"
  | "no-word"
  | "root"
  | { action: WordCardAction };

export interface ReaderStep {
  state: ReaderState;
  outcome: ReaderOutcome;
}

export const initialReaderState: ReaderState = {
  position: { line: 0, phrase: 0 },
  view: "phrase",
  cardFocus: 0,
};

/** Word-card actions offered on the glasses. "picture" (illustration) is P1 and not offered. */
export const CARD_ACTIONS: readonly WordCardAction[] = ["hear"];

export function currentPhrase(page: Page, position: ReaderPosition) {
  return page.lines[position.line]?.phrases[position.phrase];
}

function step(page: Page, pos: ReaderPosition, delta: 1 | -1): ReaderPosition | null {
  const phrases = page.lines[pos.line]?.phrases.length ?? 0;
  const next = pos.phrase + delta;
  if (next >= 0 && next < phrases) return { line: pos.line, phrase: next };
  const line = pos.line + delta;
  const target = page.lines[line];
  if (!target || target.phrases.length === 0) return null;
  return { line, phrase: delta === 1 ? 0 : target.phrases.length - 1 };
}

export function readerStep(page: Page, state: ReaderState, gesture: GlassesGesture): ReaderStep {
  if (state.view === "card") {
    switch (gesture) {
      case "back":
        return {
          state: { ...state, view: "phrase", cardFocus: 0, card: undefined },
          outcome: "card-closed",
        };
      case "left":
      case "right": {
        const focus = state.cardFocus + (gesture === "right" ? 1 : -1);
        if (focus < 0 || focus >= CARD_ACTIONS.length) return { state, outcome: "boundary" };
        return { state: { ...state, cardFocus: focus }, outcome: "card-focus" };
      }
      case "select": {
        const action = CARD_ACTIONS[state.cardFocus];
        return action ? { state, outcome: { action } } : { state, outcome: "boundary" };
      }
      case "up":
      case "down":
        // Definitions are short enough to need no scrolling (display limits).
        return { state, outcome: "boundary" };
    }
  }

  switch (gesture) {
    case "right":
    case "left": {
      // Gestures move by phrase; the pointed word no longer applies.
      const position = step(
        page,
        { line: state.position.line, phrase: state.position.phrase },
        gesture === "right" ? 1 : -1,
      );
      if (!position) return { state, outcome: "boundary" };
      return { state: { ...state, position }, outcome: "moved" };
    }
    case "down":
    case "up": {
      const line = state.position.line + (gesture === "down" ? 1 : -1);
      if (!page.lines[line]?.phrases.length) return { state, outcome: "boundary" };
      return { state: { ...state, position: { line, phrase: 0 } }, outcome: "moved" };
    }
    case "select":
      // The word under the finger first, else the phrase's hard word.
      if (state.position.word === undefined && !currentPhrase(page, state.position)?.hardWord) {
        return { state, outcome: "no-word" };
      }
      return { state: { ...state, view: "card", cardFocus: 0 }, outcome: "card-opened" };
    case "back":
      return { state, outcome: "root" };
  }
}

/** Put the reader on a specific line (finger tracking), starting at its first phrase. */
export function moveToLine(page: Page, state: ReaderState, line: number): ReaderState {
  if (!page.lines[line] || line === state.position.line) return state;
  return { ...state, position: { line, phrase: 0 }, view: "phrase", cardFocus: 0, card: undefined };
}
