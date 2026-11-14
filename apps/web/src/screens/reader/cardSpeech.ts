// What a card says out loud, and whether it should be read automatically. Pure, so it is tested.
import { isLoading } from "@/api";
import type { WordCard } from "@/glasses";

/** What "Hear it" and Read aloud say for a card. */
export function cardSpeech(card: WordCard): string {
  return card.say ?? `${card.word}. ${card.short}`;
}

/**
 * The text to read aloud when this card appears, or null when there is nothing to read yet: a
 * placeholder while a definition or answer is still being fetched, a progress message, a failure
 * to look something up (it has no text), or an empty card.
 */
export function cardToAutoRead(card: WordCard | undefined): string | null {
  if (!card || card.problem || card.pending || isLoading(card)) return null;
  const text = cardSpeech(card).trim();
  return card.short.trim() || card.say?.trim() ? text : null;
}
