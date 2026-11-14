// What the simulated Ray-Ban Display can show, and the limits that keep it honest
// (SIM-DSP-03, one thing at a time):
//   - exactly ONE item: a short phrase, a word card or an image (plus an optional status icon);
//   - no newlines or paragraphs;
//   - anything too long is truncated at a word boundary with an ellipsis and a warning logged.
//
// [ASSUMPTION] The limits are ours; Meta's docs give none. ~12 words per phrase and ~25 words
// per definition (SIMULATION_FEATURES.md SIM-DSP-03).
// OPEN QUESTION: real text limits for the 600x600 display (section 9, question 2).
import type { WordCard, WordCardAction, WordCardProblem } from "../adapter";

export const DISPLAY_LIMITS = {
  phraseMaxWords: 12,
  wordMaxWords: 3,
  definitionMaxWords: 25,
} as const;

export type DisplayContent =
  | { kind: "phrase"; text: string; emphasis?: [number, number] }
  | {
      kind: "word";
      word: string;
      short: string;
      actions: WordCardAction[];
      focused?: WordCardAction;
      /** No definition to show: the card says what went wrong instead. */
      problem?: WordCardProblem;
    }
  | { kind: "image"; url: string };

type Warn = (message: string) => void;

/** Collapse all whitespace (including newlines) to single spaces: no paragraphs on the display. */
export function normaliseText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Keep at most `max` words; longer text ends with an ellipsis. Returns [text, truncated]. */
export function limitWords(text: string, max: number): [string, boolean] {
  const words = text.split(" ").filter(Boolean);
  if (words.length <= max) return [text, false];
  return [`${words.slice(0, max).join(" ")}…`, true];
}

/** Clamp an emphasis range to the visible text; drop it if nothing is left to highlight. */
export function clampEmphasis(
  emphasis: [number, number] | undefined,
  visibleLength: number,
): [number, number] | undefined {
  if (!emphasis) return undefined;
  const start = Math.max(0, Math.min(emphasis[0], visibleLength));
  const end = Math.max(start, Math.min(emphasis[1], visibleLength));
  return end > start ? [start, end] : undefined;
}

export function makePhrase(
  text: string,
  emphasis?: [number, number],
  warn: Warn = () => {},
): DisplayContent | null {
  const normalised = normaliseText(text);
  if (!normalised) return null;
  const [visible, cut] = limitWords(normalised, DISPLAY_LIMITS.phraseMaxWords);
  if (cut) warn(`phrase over ${DISPLAY_LIMITS.phraseMaxWords} words truncated: "${normalised}"`);
  // Emphasis offsets refer to the caller's text. If normalising changed the text, the offsets
  // no longer line up, so drop them rather than highlight the wrong words.
  const offsetsValid = normalised === text;
  // Never highlight into the ellipsis.
  const highlightable = cut ? visible.length - 1 : visible.length;
  const clamped = offsetsValid ? clampEmphasis(emphasis, highlightable) : undefined;
  return clamped
    ? { kind: "phrase", text: visible, emphasis: clamped }
    : { kind: "phrase", text: visible };
}

export function makeWordCard(card: WordCard, warn: Warn = () => {}): DisplayContent | null {
  const [word, wordCut] = limitWords(normaliseText(card.word), DISPLAY_LIMITS.wordMaxWords);
  if (!word) return null;
  if (wordCut) warn(`word card heading over ${DISPLAY_LIMITS.wordMaxWords} words truncated`);
  const [short, shortCut] = limitWords(
    normaliseText(card.short),
    DISPLAY_LIMITS.definitionMaxWords,
  );
  if (shortCut) {
    warn(`definition over ${DISPLAY_LIMITS.definitionMaxWords} words truncated: "${card.word}"`);
  }
  if (card.problem) {
    // Nothing to hear or picture: no actions, just the problem.
    return { kind: "word", word, short: "", actions: [], problem: card.problem };
  }
  const actions = [...new Set(card.actions ?? [])];
  const focused = card.focused && actions.includes(card.focused) ? card.focused : actions[0];
  return focused
    ? { kind: "word", word, short, actions, focused }
    : { kind: "word", word, short, actions };
}

export function makeImage(url: string): DisplayContent | null {
  const trimmed = url.trim();
  return trimmed ? { kind: "image", url: trimmed } : null;
}
