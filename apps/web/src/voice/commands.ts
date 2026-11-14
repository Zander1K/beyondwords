// Voice commands for reading. Turns a transcript into an app command. Plain logic: the transcript
// can come from the simulator's speech recognition today or Gemini Live later.
// HACK: keyword matching. Gemini Live will handle free-form questions (build order step 7);
// this only covers the commands a reader needs while their hands are on the book.

export type VoiceCommand =
  | { kind: "next" }
  | { kind: "prev" }
  | { kind: "read" }
  | { kind: "stop" }
  | { kind: "capture" }
  | { kind: "viewfinder" }
  | { kind: "dismiss" }
  | { kind: "define"; word: string }
  | { kind: "unknown"; text: string };

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Checked in order; the first match wins. "define" runs first so "what does next mean" is a
// definition, not a navigation command.
const DEFINE_PATTERNS = [
  /^what does (?:the word )?(.+?) mean$/,
  /^what's the meaning of (.+)$/,
  /^what is the meaning of (.+)$/,
  /^(?:the )?meaning of (.+)$/,
  /^define (?:the word )?(.+)$/,
  /^explain (?:the word )?(.+)$/,
  /^what is (?:a |an |the )?(.+)$/,
];

const PHRASES: ReadonlyArray<[VoiceCommand["kind"], readonly string[]]> = [
  [
    "capture",
    [
      "take a photo",
      "take a picture",
      "take photo",
      "capture",
      "capture page",
      "capture the page",
      "scan",
      "scan page",
      "scan the page",
      "photo",
    ],
  ],
  [
    "viewfinder",
    ["show camera", "show the camera", "viewfinder", "line up", "line up the page", "aim"],
  ],
  ["next", ["next", "next line", "next phrase", "go on", "continue", "forward", "keep going"]],
  ["prev", ["back", "go back", "previous", "previous line", "previous phrase"]],
  [
    "read",
    [
      "read",
      "read this",
      "read it",
      "read aloud",
      "read that",
      "say it",
      "say it again",
      "repeat",
      "again",
    ],
  ],
  ["stop", ["stop", "pause", "stop reading", "be quiet", "quiet"]],
  ["dismiss", ["close", "hide", "clear", "dismiss", "cancel"]],
];

export function parseVoiceCommand(transcript: string): VoiceCommand {
  const text = normalise(transcript)
    .replace(/^(?:please |can you |could you )/, "")
    .replace(/ please$/, "");
  if (!text) return { kind: "unknown", text: "" };

  for (const pattern of DEFINE_PATTERNS) {
    const match = pattern.exec(text);
    const word = match?.[1]?.trim();
    // A definition is about one word (or a short compound), not a whole question.
    if (word && word.split(" ").length <= 2) return { kind: "define", word };
  }

  for (const [kind, phrases] of PHRASES) {
    if (phrases.includes(text)) return { kind } as VoiceCommand;
  }
  return { kind: "unknown", text };
}
