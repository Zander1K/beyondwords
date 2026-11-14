// What the simulated Ray-Ban Display can show, and the rules that keep it honest.
//
// The real display is 600x600 px with a ~20 degree field of view in the right lens. It can only
// show a little at a time, so the simulator enforces the same limits itself:
//   - exactly ONE item at a time: a short phrase, a word card, or an image (or nothing);
//   - single line of normalised text, no newlines, no scrolling paragraphs;
//   - long text is cut at a word boundary with an ellipsis, never wrapped into a paragraph.
//
// HACK: the character limits below are guesses for legibility at ~20 degree FOV.
// OPEN QUESTION: real text limits for Ray-Ban Display (font size, lines per screen). Confirm
// against the Meta DAT display docs / SOP section 9 and tune.

import type { WordCard } from "../adapter";

export const DISPLAY_LIMITS = {
  phraseMaxChars: 60,
  wordMaxChars: 24,
  shortMaxChars: 60,
} as const;

export type DisplayContent =
  | { kind: "phrase"; text: string; emphasis?: [number, number] }
  | { kind: "word"; word: string; short: string }
  | { kind: "image"; url: string };

/** Collapse all whitespace (including newlines) to single spaces: no paragraphs on the display. */
export function normaliseText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Cut to `max` characters at a word boundary where possible, ending with an ellipsis. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = max - 1; // leave space for the ellipsis
  const cut = text.slice(0, room);
  const lastSpace = cut.lastIndexOf(" ");
  // Only back off to a word boundary if it keeps most of the text.
  const end = lastSpace >= room * 0.6 ? lastSpace : room;
  return `${cut.slice(0, end).trimEnd()}…`;
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

export function makePhrase(text: string, emphasis?: [number, number]): DisplayContent | null {
  const normalised = normaliseText(text);
  if (!normalised) return null;
  // Emphasis offsets refer to the caller's text. If normalising changed the text, the offsets
  // no longer line up, so drop them rather than highlight the wrong words.
  const offsetsValid = normalised === text;
  const visible = truncate(normalised, DISPLAY_LIMITS.phraseMaxChars);
  // Never highlight into the ellipsis.
  const highlightable = visible.endsWith("…") ? visible.length - 1 : visible.length;
  const clamped = offsetsValid ? clampEmphasis(emphasis, highlightable) : undefined;
  return clamped
    ? { kind: "phrase", text: visible, emphasis: clamped }
    : { kind: "phrase", text: visible };
}

export function makeWordCard(card: WordCard): DisplayContent | null {
  const word = truncate(normaliseText(card.word), DISPLAY_LIMITS.wordMaxChars);
  if (!word) return null;
  const short = truncate(normaliseText(card.short), DISPLAY_LIMITS.shortMaxChars);
  return { kind: "word", word, short };
}

export function makeImage(url: string): DisplayContent | null {
  const trimmed = url.trim();
  return trimmed ? { kind: "image", url: trimmed } : null;
}
