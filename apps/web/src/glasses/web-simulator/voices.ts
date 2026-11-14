// The voice library: which of the browser's text-to-speech voices to offer, and in what order.
//
// The browser exposes whatever voices the operating system and browser ship, from lifelike neural
// voices (Edge's "Natural" voices, Chrome's Google voices, macOS Premium/Enhanced and Siri voices)
// down to robotic ones and novelty voices ("Zarvox", "Bubbles"). The default pick of the engine is
// often a robotic one, which is hard to listen to for a long book. So: drop the novelty voices,
// score the rest by how natural they tend to sound (judged from their names and where they run),
// and put the best first.
// [ASSUMPTION] A voice's name is the best signal the browser gives about its quality; the scores
// are our judgement, not a measurement. Check by ear, and adjust here.
// Pure functions, no browser APIs (the adapter feeds them the browser's voices).

/** The parts of a browser SpeechSynthesisVoice used here. */
export interface RawVoice {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
}

export interface VoiceInfo {
  /** Stable id: the voice's voiceURI. */
  id: string;
  name: string;
  /** BCP 47, e.g. "en-GB". */
  lang: string;
  /** Runs on this device (works offline) rather than over the network. */
  local: boolean;
  /** Judged likely to sound natural (neural, premium, Google, Siri...). */
  natural: boolean;
  score: number;
}

/** macOS novelty and joke voices: never offered. */
const NOVELTY = new Set(
  [
    "Albert",
    "Bad News",
    "Bahh",
    "Bells",
    "Boing",
    "Bubbles",
    "Cellos",
    "Deranged",
    "Fred",
    "Good News",
    "Hysterical",
    "Jester",
    "Junior",
    "Kathy",
    "Organ",
    "Princess",
    "Ralph",
    "Superstar",
    "Trinoids",
    "Whisper",
    "Wobble",
    "Zarvox",
  ].map((n) => n.toLowerCase()),
);

/** Everyday system voices that sound good enough to recommend. */
const GOOD_SYSTEM =
  /\b(samantha|daniel|karen|moira|tessa|serena|ava|allison|susan|zoe|oliver|kate)\b/i;

/** The name without its decoration, e.g. "Daniel (Enhanced)" -> "daniel". */
const baseName = (name: string) =>
  name
    .replace(/\(.*?\)/g, "")
    .trim()
    .toLowerCase();

export function isNovelty(name: string): boolean {
  return NOVELTY.has(baseName(name));
}

/** How natural a voice is likely to sound: higher is better. */
export function scoreVoice(v: RawVoice): number {
  const n = v.name;
  let score = 0;
  if (/natural|neural/i.test(n)) score += 40;
  if (/premium|enhanced|studio|journey|wavenet/i.test(n)) score += 30;
  if (/^google\b/i.test(n)) score += 20;
  if (/siri/i.test(n)) score += 15;
  if (/online/i.test(n)) score += 10;
  if (GOOD_SYSTEM.test(n)) score += 12;
  if (/espeak|compact/i.test(n)) score -= 30;
  // Network voices are usually the more lifelike ones; local ones work offline. A small nudge.
  if (!v.localService) score += 5;
  return score;
}

/** Natural enough to label "Natural" in the picker. */
export const NATURAL_SCORE = 20;

const primary = (lang: string) => lang.toLowerCase().split(/[-_]/)[0] ?? "";

/**
 * The voices to offer, best first: those in `preferredLang`'s language, then the rest, each group
 * by score (then name). Novelty voices are left out; a repeated name is listed once.
 */
export function buildLibrary(voices: readonly RawVoice[], preferredLang = "en"): VoiceInfo[] {
  const want = primary(preferredLang);
  const seen = new Set<string>();
  const out: VoiceInfo[] = [];
  for (const v of voices) {
    if (isNovelty(v.name)) continue;
    const key = `${v.name}|${v.lang}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const score = scoreVoice(v);
    out.push({
      id: v.voiceURI,
      name: v.name,
      lang: v.lang,
      local: v.localService,
      natural: score >= NATURAL_SCORE,
      score,
    });
  }
  return out.sort(
    (a, b) =>
      Number(primary(b.lang) === want) - Number(primary(a.lang) === want) ||
      b.score - a.score ||
      a.name.localeCompare(b.name),
  );
}

/**
 * The voice to speak with: the reader's saved choice if it is still available, otherwise the best
 * in their language. null when the browser has no voices (the engine then uses its own default).
 */
export function chooseVoice(
  library: readonly VoiceInfo[],
  savedId: string | null,
  preferredLang = "en",
): VoiceInfo | null {
  const saved = savedId ? library.find((v) => v.id === savedId) : undefined;
  if (saved) return saved;
  const want = primary(preferredLang);
  return library.find((v) => primary(v.lang) === want) ?? library[0] ?? null;
}
