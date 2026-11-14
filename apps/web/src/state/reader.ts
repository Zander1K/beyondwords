// Reader state (Zustand). SIM-SES-07: the phone is the source of truth. Page, position, view and
// the app's view of the glasses session live here, never in the adapter or the panel, so the
// adapter can be torn down and recreated without losing the reading position.
import { create } from "zustand";

import type { GlassesGesture, SessionState, WordCard } from "@/glasses";
import {
  fetchIllustration,
  fetchWordCard,
  isLoading,
  recordWord,
  willIllustrate,
  wordCardNow,
} from "@/api";
import {
  type Box,
  currentPhrase,
  EMPTY_PAGE,
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
  | { status: "live"; lines: number; ocrMs: number; scans: number; reused?: number }
  | { status: "empty"; ocrMs: number }
  /** `cause` is the underlying error text, for diagnosing (shown small under the message). */
  | { status: "error"; message: string; cause?: string };

/**
 * The word card for a reading position: the word under the finger, else the phrase's hard word.
 * Undefined when there is neither.
 */
function cardFor(page: Page, position: ReaderPosition): WordCard | undefined {
  const pointed =
    position.word !== undefined ? page.lines[position.line]?.words?.[position.word] : undefined;
  return pointed
    ? wordCardNow(pointed.text, page.lines[position.line]?.text ?? "")
    : currentPhrase(page, position)?.hardWord?.card;
}

/**
 * A word card has just opened on the word under the finger or mouse: add it to the reader's word
 * bank (with the book and the line it was in). Nothing for a stray mark or an OCR misread.
 */
function noteLookup(page: Page, position: ReaderPosition): void {
  if (position.word === undefined) return;
  const line = page.lines[position.line];
  const word = line?.words?.[position.word];
  if (!line || !word) return;
  if (wordCardNow(word.text, line.text).problem === "not-found") return;
  recordWord(word.text, line.text, "define");
}

/** A different word card is showing now than before: that is a lookup. */
function lookupIfOpened(before: ReaderState): void {
  const { reader, page } = useReaderStore.getState();
  if (reader.view === "card" && reader.card && reader.card !== before.card) {
    noteLookup(page, reader.position);
  }
}

/**
 * If the open card is still a placeholder, fetch the real definition and swap it in, provided
 * the card is still open on that same word when the answer arrives.
 */
function refreshCard(): void {
  const { reader, page } = useReaderStore.getState();
  const card = reader.card;
  if (reader.view !== "card" || !card || !isLoading(card)) return;
  const sentence = page.lines[reader.position.line]?.text ?? "";
  void fetchWordCard(card.word, sentence).then((real) => {
    const now = useReaderStore.getState().reader;
    if (now.view !== "card" || now.card?.word !== card.word || !isLoading(now.card)) return;
    // A picture follows the words: it is slower, and the card is useful without it. Show that it
    // is coming (a loading placeholder) from the moment the words are in.
    const drawing = !real.problem && willIllustrate(card.word, sentence);
    useReaderStore.setState({
      reader: {
        ...now,
        card: { ...real, focused: now.card.focused, ...(drawing ? { imageLoading: true } : {}) },
      },
    });
    if (drawing) {
      void fetchIllustration(card.word, sentence).then((imageUrl) => {
        const open = useReaderStore.getState().reader;
        if (open.view !== "card" || open.card?.word !== real.word) return;
        // The picture, or (declined, failed) no picture: either way the loading state ends.
        useReaderStore.setState({
          reader: {
            ...open,
            card: { ...open.card, imageLoading: false, ...(imageUrl ? { imageUrl } : {}) },
          },
        });
      });
    }
  });
}

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
  /** Put a card on the display (view "card") at the current position, e.g. the page's gist. */
  showCard: (card: WordCard) => void;
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
  // No text until the camera (or the ebook) gives the reader some.
  page: EMPTY_PAGE,
  reader: initialReaderState,
  session: "stopped",
  offline: false,
  asleep: false,
  scan: { status: "idle" },
  handLost: false,
  applyGesture: (gesture) => {
    const page = get().page;
    const before = get().reader;
    let step = readerStep(page, get().reader, gesture);
    if (step.outcome === "card-opened") {
      step = { ...step, state: { ...step.state, card: cardFor(page, step.state.position) } };
    }
    if (step.state !== get().reader) set({ reader: step.state });
    if (step.outcome === "card-opened") lookupIfOpened(before);
    refreshCard();
    return step;
  },
  goToLine: (line) => set((s) => ({ reader: moveToLine(s.page, s.reader, line) })),
  showCard: (card) => set((s) => ({ reader: { ...s.reader, view: "card", card, cardFocus: 0 } })),
  setPage: (page) => set({ page, reader: initialReaderState }),
  mergeScan: (next, occluded) => {
    const { page, reader } = get();
    const merged = mergePages(page, next, occluded);
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
  setPosition: (position) => {
    const before = get().reader;
    set((s) => {
      const { page, reader } = s;
      const cur = reader.position;

      // A word card is open and the finger now points at a different word: the card follows it
      // (the selected word is the one under the finger, not the one that was pinched earlier).
      // Without a word under the finger there is nothing to follow, so the usual rules apply.
      const movedToAnotherWord =
        position.word !== undefined && (cur.line !== position.line || cur.word !== position.word);
      if (reader.view === "card" && movedToAnotherWord) {
        const card = cardFor(page, position);
        return {
          reader: card
            ? { ...reader, position, card, cardFocus: 0 }
            : { ...reader, position, view: "phrase", cardFocus: 0, card: undefined },
        };
      }

      if (cur.line === position.line && cur.phrase === position.phrase) {
        // Same phrase: only the pointed word may change.
        if (cur.word === position.word) return {};
        return { reader: { ...reader, position } };
      }
      // Pointing at another phrase with no word to follow closes a word card
      // ([ASSUMPTION]: the finger moved on).
      return { reader: { ...reader, position, view: "phrase", cardFocus: 0, card: undefined } };
    });
    // The card followed the finger (or mouse) to another word: that is a lookup of that word.
    if (before.view === "card") lookupIfOpened(before);
    refreshCard();
  },
  setHandLost: (handLost) => set((s) => (s.handLost === handLost ? {} : { handLost })),
}));
