// Word help: the card for the word under the finger. The real definition comes from the API
// (POST /words/define, the reading brain). The card opens at once with a placeholder; the
// answer replaces it when it arrives. If the API cannot answer, the card says it did not load
// (SIM-UI: show errors, never a dead end) and reading continues.
import type { WordCard } from "@/glasses";

import { API_BASE_URL } from "@/config";

import { ApiError, defineWordRemote, illustrate } from "./client";
import { mockDefineWord } from "./mock";

/** The card's text while the definition is being fetched. */
export const LOADING_SHORT = "Looking it up…";

const cache = new Map<string, WordCard>();
/** Words the picture service declined ("better explained than pictured"): do not ask again. */
const declined = new Set<string>();
/** Pictures being generated right now, so a card opened meanwhile still shows the loading state. */
const inflight = new Set<string>();
const clean = (word: string) => word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
// "portcullis," and "portcullis" are the same lookup.
const key = (word: string, sentence: string) => `${clean(word).toLowerCase()}|${sentence}`;

/** The card to show right now: the answer if we have it, else a placeholder. */
export function wordCardNow(word: string, sentence: string): WordCard {
  const k = key(word, sentence);
  const hit = cache.get(k);
  if (hit) return inflight.has(k) && !hit.imageUrl ? { ...hit, imageLoading: true } : hit;
  // Nothing to look up (a stray mark, an OCR misread): answer locally, no call.
  const local = mockDefineWord(word);
  if (local.problem) return local;
  return { word: clean(word) || word, short: LOADING_SHORT };
}

/** Whether a card is still the placeholder. */
export const isLoading = (card: WordCard | undefined): boolean => card?.short === LOADING_SHORT;

/** Fetch (once) the real card for a word in its sentence. Never throws. */
export async function fetchWordCard(word: string, sentence: string): Promise<WordCard> {
  const hit = cache.get(key(word, sentence));
  if (hit) return hit;
  const shown = clean(word) || word;
  try {
    const r = await defineWordRemote({ word: shown, sentence });
    if (r.degraded || !r.meaning) return { word: shown, short: "", problem: "load-failed" };
    // How to say it: the brain's respelling ("port-KULL-iss"), else the syllables.
    const pronunciation = (r.say_as ?? "").trim() || (r.syllables ?? []).join("·");
    const card: WordCard = {
      word: r.word || shown,
      ...(pronunciation ? { pronunciation } : {}),
      short: r.meaning,
      ...(r.illustratable ? { illustratable: true } : {}),
    };
    cache.set(key(word, sentence), card);
    return card;
  } catch {
    return { word: shown, short: "", problem: "load-failed" };
  }
}

/**
 * The illustration for a word's card, or null (not a pictureable word, still being made, or the
 * picture service is down: the card then simply has no picture). The picture is cached on the
 * card so reopening it shows it at once. Never throws.
 */
export async function fetchIllustration(word: string, sentence: string): Promise<string | null> {
  const k = key(word, sentence);
  const card = cache.get(k);
  if (card?.imageUrl) return card.imageUrl;
  if (!card?.illustratable || declined.has(k)) return null;
  inflight.add(k);
  try {
    const r = await illustrate({ text: clean(word) || word });
    const imageUrl = `${API_BASE_URL}${r.url}`;
    cache.set(k, { ...card, imageUrl });
    return imageUrl;
  } catch (error) {
    // 422 = the service decided this word is not for a picture (an idea, a name): final.
    // Anything else (down, slow) may work next time, so it is not remembered.
    if (error instanceof ApiError && error.status === 422) declined.add(k);
    return null;
  } finally {
    inflight.delete(k);
  }
}

/** A picture will be generated for this word's card (so the card can show it is loading). */
export function willIllustrate(word: string, sentence: string): boolean {
  const k = key(word, sentence);
  const card = cache.get(k);
  return Boolean(card?.illustratable && !card.imageUrl && !declined.has(k));
}
