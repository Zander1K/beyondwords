// The embedded ebook: a short story written for this app (original text, not from any book), four
// pages. It exists so the reader can be tried without a camera or a printed book: the mouse
// cursor stands in for the fingertip, and the same Page model the camera path produces drives the
// same highlight, word card and glasses display.
//
// Each page is a list of lines, written to the length of a line in a printed book. A line is
// split into phrases by the same splitter the camera path uses (api/mock.ts), so phrase
// highlighting behaves the same way in both modes.
import { splitPhrases } from "@/api/mock";
import { line, type Page, type PageWord, phrase } from "@/reader";

export const EBOOK = {
  title: "The Lantern Maker's Daughter",
  byline: "A short story written for Beyond Words",
  chapter: "Chapter One: The Last Lantern",
  pages: [
    [
      "Mira lived at the edge of a harbour town,",
      "above a shop that smelled of hot metal.",
      "Her father made lanterns for the fishing boats.",
      "Each one was round and heavy and bright,",
      "with a tiny door for the flame.",
      "Every evening, the boats sailed out to sea.",
      "Every morning, they came safely home again.",
      "Mira loved the quiet hours before the tide turned,",
      "when the workshop glowed like a sleeping animal.",
      "She would sit on a stool and watch",
      "her father bend the copper with patient hands.",
      "“A lantern is a promise,” he liked to say.",
    ],
    [
      "One autumn, a thick fog rolled in from the water.",
      "It was the colour of old milk,",
      "and it swallowed the street lamps one by one.",
      "By nightfall, the harbour had vanished completely.",
      "Her father pulled on his heavy coat.",
      "“Three boats are still out there,” he whispered.",
      "“Their lanterns are too small to be seen.”",
      "He reached for the last lantern on the shelf,",
      "the great brass one he had been saving",
      "for a special day, and held it up to the dark.",
      "But his hands were trembling, and the glass",
      "slipped and cracked on the stone floor.",
    ],
    [
      "Mira stared at the broken glass in silence.",
      "Then she remembered the old mirror in the attic,",
      "a curious thing her grandmother had left behind.",
      "She ran up the narrow, creaking stairs",
      "and dragged it down, step by step.",
      "Together they set the mirror behind the flame.",
      "The light leapt up and stretched across the water,",
      "a long, golden road through the fog.",
      "“Higher,” said her father. “Lift it higher.”",
      "Mira climbed the tower with the lantern in her arms,",
      "her heart pounding louder than the waves.",
    ],
    [
      "At the top, the wind pulled at her hair.",
      "She held the lantern high and waited.",
      "For a long time, there was only darkness.",
      "Then a small voice drifted out of the fog,",
      "and another, and another, growing stronger.",
      "One by one, the boats appeared,",
      "their sails pale and their crews grinning.",
      "They followed the golden road all the way home.",
      "That night, the whole town gathered on the shore.",
      "Mira's father hugged her and said nothing at all.",
      "He did not need to. She understood.",
      "A lantern is a promise, and she had kept it.",
    ],
  ],
} as const;

export const EBOOK_PAGE_COUNT = EBOOK.pages.length;

/** The words of a line with their character ranges. Boxes are unused here (no camera image). */
export function wordsOf(text: string): PageWord[] {
  const out: PageWord[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    const start = m.index ?? 0;
    out.push({
      text: m[0],
      start,
      end: start + m[0].length,
      box: { x: 0, y: 0, w: 0, h: 0 },
    });
  }
  return out;
}

/** Ebook page `index` (0-based) as the reader's Page model: lines, phrases and words. */
export function ebookPage(index: number): Page {
  const at = Math.max(0, Math.min(EBOOK_PAGE_COUNT - 1, index));
  const lines = EBOOK.pages[at] ?? [];
  return {
    id: `ebook-${at + 1}`,
    lines: lines.map((text) => ({
      ...line(...splitPhrases(text).map((p) => phrase(p))),
      words: wordsOf(text),
    })),
  };
}
