// The display scene: the ONLY things the simulated Ray-Ban Display can show.
// [VERIFIED] Apps build screens from flexbox layouts, text (heading/body/meta presets), images
// from a URL (size, corner radius), buttons and system icons; every update replaces the whole
// screen. Video exists on the real display but is not needed, so it is not built (SIM-DSP-01).
//
// Callers never pass markup: the adapter turns show* calls into a scene of these nodes, and the
// panel renders nothing else.
import type { StatusKind, WordCardAction } from "../adapter";
import type { DisplayContent } from "./displayModel";

export type TextPreset = "heading" | "body" | "meta";

/**
 * OPEN QUESTION: whether real Text components support a colour/weight for emphasis. The phrase
 * highlight uses `tone: "accent"`; if the display only has presets, fall back to the heading
 * preset for the emphasised words.
 */
export type TextTone = "default" | "accent" | "muted";

export type IconName = StatusKind;

export type SceneNode =
  | {
      type: "flex";
      direction: "row" | "column";
      gap?: number;
      align?: "start" | "center" | "end";
      justify?: "start" | "center" | "end" | "between";
      wrap?: boolean;
      children: SceneNode[];
    }
  | { type: "text"; preset: TextPreset; text: string; tone?: TextTone }
  | { type: "image"; url: string; width: number; height: number; radius: number }
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
  "hand-lost": "Hand lost",
  offline: "Offline",
  reconnecting: "Reconnecting",
  "no-page": "No page",
};

function statusRow(status: StatusKind): SceneNode {
  return {
    type: "flex",
    direction: "row",
    gap: 8,
    align: "center",
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
  return { type: "flex", direction: "row", wrap: true, gap: 12, justify: "center", children };
}

function itemNode(item: DisplayContent): SceneNode {
  switch (item.kind) {
    case "phrase":
      return phraseRow(item.text, item.emphasis);
    case "word":
      return {
        type: "flex",
        direction: "column",
        gap: 16,
        align: "center",
        children: [
          { type: "text", preset: "heading", text: item.word },
          { type: "text", preset: "body", text: item.short },
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
      return { type: "image", url: item.url, width: 480, height: 400, radius: 24 };
  }
}

/** One item (or none) plus an optional small status icon: the one-thing-at-a-time rule. */
export function buildScene(item: DisplayContent | null, status: StatusKind | null): Scene {
  if (!item && !status) return null;
  const children: SceneNode[] = [];
  if (status) children.push(statusRow(status));
  if (item) children.push(itemNode(item));
  return {
    type: "flex",
    direction: "column",
    gap: 24,
    align: "center",
    justify: "center",
    children,
  };
}
