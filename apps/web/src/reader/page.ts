// Page model the reader works on: lines in reading order, each split into phrases.
// OPEN QUESTION: the real page JSON schema is SOP section 8.1, which is not in the repo yet
// (apps/api/app/schemas/page.py is a placeholder). This is our working shape; align it with
// the backend schema once it exists.
import type { WordCard } from "@/glasses";

export interface Box {
  /** Normalised 0-1 page coordinates. OPEN QUESTION #3: pixels or normalised. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Phrase {
  text: string;
  /** A hard word in this phrase: its [start, end) range within `text` and a short definition. */
  hardWord?: { range: [number, number]; card: WordCard };
}

export interface PageLine {
  text: string;
  phrases: Phrase[];
  /** Where the line is in the camera image (normalised), from OCR. */
  box?: Box;
  /** The line's baseline (normalised), used to pick the line under the fingertip. */
  baseline?: { x0: number; y0: number; x1: number; y1: number };
  /** Words with their boxes (normalised) and [start, end) offsets in `text`, from OCR. */
  words?: PageWord[];
}

export interface PageWord {
  text: string;
  box: Box;
  start: number;
  end: number;
}

export interface Page {
  id: string;
  lines: PageLine[];
}

/** Build a phrase, finding the hard word's range in the text. */
export function phrase(text: string, word?: string, short?: string): Phrase {
  if (!word || !short) return { text };
  const start = text.indexOf(word);
  if (start < 0) throw new Error(`"${word}" is not in "${text}"`);
  return { text, hardWord: { range: [start, start + word.length], card: { word, short } } };
}

/** Build a line from its phrases. */
export function line(...phrases: Phrase[]): PageLine {
  return { text: phrases.map((p) => p.text).join(" "), phrases };
}
