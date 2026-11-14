// MOCK RESPONSES for endpoints that do not exist yet. Everything here is a stand-in.
// TODO(alex, with Matthew): replace with the real POST /pages/analyze and POST /words/define
// once the brain is wired up (page JSON schema: SOP section 8.1, not in the repo yet).
import type { Box, Page, PageLine, Phrase } from "@/reader";

/** OCR line as sent to page analysis. */
export interface AnalyzeLine {
  text: string;
  box: Box;
  baseline: { x0: number; y0: number; x1: number; y1: number };
}

/** Longest phrase we build. [ASSUMPTION] Phrase-level reading wants ~3-6 words. */
const MAX_PHRASE_WORDS = 6;

/**
 * MOCK phrase splitting: split after punctuation, then halve any chunk that is still long.
 * The real brain chooses meaningful phrase boundaries.
 */
export function splitPhrases(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[][] = [[]];
  for (const word of words) {
    chunks[chunks.length - 1]?.push(word);
    if (/[,;:.!?]["”’)]?$/.test(word)) chunks.push([]);
  }
  // A lone word left after punctuation ("..., the") reads badly on its own: merge it back.
  const merged: string[][] = [];
  for (const chunk of chunks.filter((c) => c.length)) {
    const prev = merged[merged.length - 1];
    if (chunk.length === 1 && prev) prev.push(...chunk);
    else merged.push(chunk);
  }
  const out: string[] = [];
  for (const chunk of merged) {
    if (chunk.length <= MAX_PHRASE_WORDS) {
      out.push(chunk.join(" "));
      continue;
    }
    const parts = Math.ceil(chunk.length / MAX_PHRASE_WORDS);
    const size = Math.ceil(chunk.length / parts);
    for (let i = 0; i < chunk.length; i += size) out.push(chunk.slice(i, i + size).join(" "));
  }
  return out;
}

// MOCK word help: a few definitions so the demo has something to show. Not a dictionary.
const MOCK_DEFINITIONS: Record<string, string> = {
  lighthouse: "A tall tower with a bright light that guides ships.",
  restless: "Always moving; never calm.",
  narrow: "Not wide; only a little space from side to side.",
  patient: "Able to wait calmly.",
  evening: "The end of the day, before night.",
};

const MIN_HARD_WORD_LETTERS = 9;

/** MOCK hard-word pick: a known mock word, or any long word. One per phrase. */
function hardWord(text: string): Phrase["hardWord"] {
  for (const m of text.matchAll(/\p{L}[\p{L}'’-]*/gu)) {
    const word = m[0];
    const key = word.toLowerCase();
    const known = MOCK_DEFINITIONS[key];
    if (known || word.length >= MIN_HARD_WORD_LETTERS) {
      const start = m.index;
      return {
        range: [start, start + word.length],
        card: {
          word,
          short: known ?? "(mock) A definition will come from the reading brain.",
        },
      };
    }
  }
  return undefined;
}

/**
 * MOCK of POST /pages/analyze: OCR lines -> page JSON (reading order, phrases, hard words).
 * Reading order is OCR top-to-bottom; two-column pages are not handled.
 */
export async function mockAnalyzePage(lines: AnalyzeLine[]): Promise<Page> {
  const pageLines: PageLine[] = lines.map((l) => {
    const phrases: Phrase[] = splitPhrases(l.text).map((text) => {
      const word = hardWord(text);
      return word ? { text, hardWord: word } : { text };
    });
    return {
      text: phrases.map((p) => p.text).join(" "),
      phrases,
      box: l.box,
      baseline: l.baseline,
    };
  });
  return { id: `scan-${Date.now()}`, lines: pageLines.filter((l) => l.phrases.length) };
}
