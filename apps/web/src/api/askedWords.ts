// Which words a spoken question is about, so "what does portcullis mean?" lands in the word bank.
// Only a question that asks for a meaning, pronunciation or the like counts, and only words that
// are on the page the reader is looking at (so a question about the story does not).

const ASKING_ABOUT_A_WORD =
  /\b(mean|means|meaning|define|definition|what is|what's|whats|pronounce|pronunciation|say|spell|synonym)\b/i;

/** Everyday words that are never the word being asked about. */
const STOP = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "what",
  "does",
  "word",
  "mean",
  "means",
  "meaning",
  "how",
  "you",
  "your",
  "can",
  "tell",
  "me",
  "about",
  "here",
  "there",
  "from",
  "have",
  "has",
  "was",
  "were",
  "are",
  "his",
  "her",
  "its",
  "they",
  "she",
  "him",
  "them",
  "who",
  "why",
  "when",
  "where",
  "which",
  "say",
  "said",
  "spell",
  "pronounce",
  "define",
  "definition",
  "synonym",
  "please",
  "not",
  "but",
  "all",
  "any",
  "one",
  "out",
  "into",
]);

const tokens = (text: string) => text.toLowerCase().match(/[\p{L}']+/gu) ?? [];

/**
 * The word(s) a question is about: those of the question's words that are on the page, or else the
 * word the reader was pointing at. Empty when the question is not asking about a word.
 */
export function wordsAskedAbout(
  question: string,
  pageWords: readonly string[],
  pointed?: string,
  max = 3,
): string[] {
  if (!ASKING_ABOUT_A_WORD.test(question)) return [];
  const onPage = new Set(pageWords.flatMap((w) => tokens(w)));
  const found = [
    ...new Set(tokens(question).filter((w) => w.length > 2 && !STOP.has(w) && onPage.has(w))),
  ].slice(0, max);
  if (found.length) return found;
  const fallback = pointed ? tokens(pointed)[0] : undefined;
  return fallback && fallback.length > 2 ? [fallback] : [];
}
