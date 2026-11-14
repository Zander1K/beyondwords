// The display scene: the ONLY things the simulated Ray-Ban Display can show.
// [VERIFIED] Apps build screens from flexbox layouts, text (heading/body/meta presets), images
// from a URL (size, corner radius), buttons and system icons; every update replaces the whole
// screen. Video exists on the real display but is not needed, so it is not built (SIM-DSP-01).
//
// Callers never pass markup: the adapter turns show* calls into a scene of these nodes, and the
// panel renders nothing else.
//
// Look: a phrase, a word card or a status sits on a frosted card or pill (`surface`), tinted
// amber or red when something is wrong (`tone`). OPEN QUESTION: whether the real FlexBox can
// carry a translucent fill, radius and tint; if not, the same layout works on plain black.
import type { StatusKind, WordCardAction, WordCardProblem } from "../adapter";
import type { DisplayContent } from "./displayModel";

export type TextPreset = "heading" | "body" | "meta";

/**
 * OPEN QUESTION: whether real Text components support a colour/weight for emphasis. The phrase
 * highlight uses `tone: "accent"`; if the display only has presets, fall back to the heading
 * preset for the emphasised words.
 */
export type TextTone = "default" | "accent" | "muted" | "ok" | "warn" | "error";

/** Tint of a card or pill: violet-blue normally, amber for a warning, red for an error. */
export type SurfaceTone = "default" | "warn" | "error";

export type IconName = StatusKind | "not-found";

export type SceneNode =
  | {
      type: "flex";
      direction: "row" | "column";
      gap?: number;
      align?: "start" | "center" | "end";
      justify?: "start" | "center" | "end" | "between";
      wrap?: boolean;
      /** A frosted card (the content) or a small pill (a status). */
      surface?: "card" | "pill";
      tone?: SurfaceTone;
      children: SceneNode[];
    }
  | { type: "text"; preset: TextPreset; text: string; tone?: TextTone }
  | { type: "image"; url: string; width: number; height: number; radius: number }
  /** A picture on its way: a shimmering block of the same size, with a short label. */
  | { type: "placeholder"; width: number; height: number; radius: number; label: string }
  | { type: "button"; label: string; focused: boolean }
  | { type: "icon"; name: IconName };

/** null = an empty scene (black, see-through on the real display). */
export type Scene = SceneNode | null;

const ACTION_LABELS: Record<WordCardAction, string> = {
  hear: "Hear it",
  picture: "Picture it",
};

export const STATUS_LABELS: Record<StatusKind, string> = {
  listening: "Listening",
  thinking: "Thinking",
  reading: "Reading the page",
  "hand-lost": "Hand lost",
  offline: "Offline",
  reconnecting: "Reconnecting",
  "no-page": "No page in view",
  "no-word": "Point at a word first",
  "load-failed": "Couldn't read the page",
};

/** Normal activity is violet-blue, "check this" is amber, "this failed" is red. */
export const STATUS_TONE: Record<StatusKind, SurfaceTone> = {
  listening: "default",
  thinking: "default",
  reading: "default",
  reconnecting: "default",
  "hand-lost": "warn",
  "no-page": "warn",
  "no-word": "warn",
  offline: "error",
  "load-failed": "error",
};

/** What a word card says when it has no definition: a headline and what to do next. */
export const PROBLEM_COPY: Record<WordCardProblem, { title: string; hint: string }> = {
  "not-found": {
    title: "No definition found",
    hint: "Try another word, or move closer to the page",
  },
  "load-failed": {
    title: "Couldn't load the definition",
    hint: "Check the connection and try again",
  },
};

function statusRow(status: StatusKind): SceneNode {
  return {
    type: "flex",
    direction: "row",
    gap: 12,
    align: "center",
    surface: "pill",
    tone: STATUS_TONE[status],
    children: [
      { type: "icon", name: status },
      { type: "text", preset: "meta", text: STATUS_LABELS[status] },
    ],
  };
}

/**
 * The phrase as a wrapping row of word Texts, so the emphasised words can use a different
 * tone without free-form markup. Words overlapping the emphasis range are emphasised.
 */
function phraseRow(text: string, emphasis?: [number, number]): SceneNode {
  const children: SceneNode[] = [];
  const re = /\S+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index;
    const end = start + m[0].length;
    const emphasised = emphasis ? start < emphasis[1] && end > emphasis[0] : false;
    children.push({
      type: "text",
      preset: "body",
      text: m[0],
      tone: emphasised ? "accent" : "default",
    });
  }
  return {
    type: "flex",
    direction: "row",
    wrap: true,
    gap: 14,
    justify: "center",
    surface: "card",
    children,
  };
}

function problemCard(word: string, problem: WordCardProblem): SceneNode {
  const copy = PROBLEM_COPY[problem];
  return {
    type: "flex",
    direction: "column",
    gap: 12,
    align: "center",
    surface: "card",
    tone: problem === "not-found" ? "warn" : "error",
    children: [
      { type: "icon", name: problem === "not-found" ? "not-found" : "load-failed" },
      { type: "text", preset: "heading", text: word },
      { type: "text", preset: "body", text: copy.title },
      { type: "text", preset: "meta", text: copy.hint },
    ],
  };
}

function itemNode(item: DisplayContent): SceneNode {
  switch (item.kind) {
    case "phrase":
      return phraseRow(item.text, item.emphasis);
    case "word":
      if (item.problem) return problemCard(item.word, item.problem);
      return {
        type: "flex",
        direction: "column",
        gap: 16,
        align: "center",
        surface: "card",
        children: [
          { type: "text", preset: "heading", text: item.word },
          ...(item.pronunciation
            ? [
                {
                  type: "text" as const,
                  preset: "meta" as const,
                  tone: "accent" as const,
                  text: item.pronunciation,
                },
              ]
            : []),
          { type: "text", preset: "body", text: item.short },
          ...(item.imageUrl
            ? [{ type: "image" as const, url: item.imageUrl, width: 300, height: 200, radius: 20 }]
            : item.imageLoading
              ? [
                  {
                    type: "placeholder" as const,
                    width: 300,
                    height: 200,
                    radius: 20,
                    label: "Drawing a picture…",
                  },
                ]
              : []),
          ...(item.actions.length
            ? [
                {
                  type: "flex" as const,
                  direction: "row" as const,
                  gap: 12,
                  justify: "center" as const,
                  children: item.actions.map((a): SceneNode => ({
                    type: "button",
                    label: ACTION_LABELS[a],
                    focused: a === item.focused,
                  })),
                },
              ]
            : []),
        ],
      };
    case "image":
      return { type: "image", url: item.url, width: 480, height: 400, radius: 28 };
  }
}

/** One item (or none) plus an optional small status pill: the one-thing-at-a-time rule. */
export function buildScene(item: DisplayContent | null, status: StatusKind | null): Scene {
  if (!item && !status) return null;
  const children: SceneNode[] = [];
  if (status) children.push(statusRow(status));
  if (item) children.push(itemNode(item));
  return {
    type: "flex",
    direction: "column",
    gap: 20,
    align: "center",
    justify: "center",
    children,
  };
}
