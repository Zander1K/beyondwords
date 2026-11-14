// HACK: hard-coded test phrases until page analysis exists (build order step 3). Written for
// this repo; not taken from any book (never commit copyrighted book text).
import type { WordCard } from "@/glasses";

export interface DemoPhrase {
  text: string;
  /** A hard word in this phrase, with its character range and a short definition. */
  hardWord?: { range: [number, number]; card: WordCard };
}

function phrase(text: string, word?: string, short?: string): DemoPhrase {
  if (!word || !short) return { text };
  const start = text.indexOf(word);
  if (start < 0) throw new Error(`"${word}" is not in "${text}"`);
  return { text, hardWord: { range: [start, start + word.length], card: { word, short } } };
}

export const DEMO_PHRASES: readonly DemoPhrase[] = [
  phrase(
    "The old lighthouse stood alone",
    "lighthouse",
    "A tall tower with a light that guides ships.",
  ),
  phrase("at the edge of the grey cliffs,"),
  phrase("and every night its lamp", "lamp", "A light, often with a flame or bulb."),
  phrase("swept slowly across the restless water.", "restless", "Always moving; never calm."),
];
