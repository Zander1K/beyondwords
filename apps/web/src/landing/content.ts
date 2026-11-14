// The landing page's words, in one place. Descriptive only: no invented numbers or claims, and no
// therapy language (CLAUDE.md section 8: "comfortable reading", never a cure or treatment).
// The product's name comes from the one APP_NAME constant (CLAUDE.md), so renaming stays a
// one-line change.
import { APP_NAME } from "@/config";

export const CTA_LABEL = "Test this App";

/** The headline in two tones: the accent part is set in blue. */
export const HERO_TITLE: readonly { text: string; accent?: boolean }[] = [
  { text: "Read the page." },
  { text: "Go beyond the words.", accent: true },
];

export const HERO = {
  pill: "Comfortable reading on smart glasses",
  description: `${APP_NAME} reads with you, not for you. Point at a line in a real book and it keeps your place, highlights the phrase you are on, and explains hard words in context, so reading feels comfortable.`,
  note: "Invite-only demo. You will need a username and the access password.",
} as const;

export const IDEA = {
  eyebrow: "The idea",
  title: "The hard part isn't the story. It's the words on the page.",
  accent: "It's the words on the page.",
  description: `Many readers follow a story perfectly well and still find getting the words off the page tiring. ${APP_NAME} supports the decoding, not the understanding: it keeps your place, shows one phrase at a time and explains what is in your way, so you stay in charge of the reading.`,
} as const;

export const STEPS = [
  {
    title: "Point at a line",
    text: `Aim the camera at a printed page and run a finger under the text. ${APP_NAME} follows your fingertip to the exact word.`,
  },
  {
    title: "See one phrase at a time",
    text: "The phrase you are on is highlighted and shown on the glasses display: short, steady and easy on the eyes, with spacing you can adjust.",
  },
  {
    title: "Get help with a word",
    text: "Pinch to open a short explanation of a hard word, in the context of the sentence. It reads with you, never for you.",
  },
] as const;

export const POWERED_BY = {
  title: "Powered by Meta, Nvidia and Google Gemini",
  accent: "Meta, Nvidia and Google Gemini",
  description: "Built for the Junction 2026 hackathon on three platforms.",
  partners: [
    {
      id: "meta",
      name: "Meta",
      role: "The glasses",
      text: `Meta AI glasses give ${APP_NAME} its eyes and a small display, hands-free, right where you read.`,
    },
    {
      id: "nvidia",
      name: "NVIDIA",
      role: "The reading brain",
      text: "NVIDIA Nemotron understands the page: the order of the lines, the phrases and the hard words.",
    },
    {
      id: "gemini",
      name: "Google Gemini",
      role: "The voice",
      text: `Google Gemini gives ${APP_NAME} a voice to talk a word through, and pictures to go with it.`,
    },
  ],
} as const;

export const TEAM = {
  eyebrow: "Developed by",
  title: "Built by three developers.",
  accent: "three developers.",
  people: ["Alexander Dare", "Matthew Oladimeji", "Michael Oladimeji"],
} as const;

export const FINAL = {
  title: "See it read with you.",
  accent: "read with you.",
  description: `Sign in with your username and the access password to try ${APP_NAME} yourself.`,
} as const;

export const FOOTER = {
  poweredBy: "Powered by Meta, Nvidia and Google Gemini.",
  developedBy: "Developed by Alexander Dare, Matthew Oladimeji and Michael Oladimeji.",
  legal: `A Junction 2026 prototype. ${APP_NAME} supports comfortable reading and is not a medical or therapeutic product. Meta, NVIDIA and Google Gemini are trademarks of their respective owners.`,
} as const;
