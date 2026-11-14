// Renders a display Scene on the 600x600 panel. SIM-DSP-01: only FlexBox, Text, Image, Button
// and Icon equivalents exist here; there is no way for a caller to inject other markup.
// Sizes are in display pixels (600 = full width) and scale with the panel via container units.
import type { CSSProperties } from "react";

import type { IconName, Scene, SceneNode } from "./scene";
import styles from "./ScenePanel.module.css";

/** Display pixels -> container units, so the 600x600 scene scales with the panel. */
const px = (n: number) => `calc(${n} / 600 * 100cqw)`;

const ALIGN = { start: "flex-start", center: "center", end: "flex-end" } as const;
const JUSTIFY = { ...ALIGN, between: "space-between" } as const;

/** Busy and listening states use the assistant ring (blue to magenta) instead of a glyph. */
const RING: Partial<Record<IconName, "spin" | "pulse">> = {
  listening: "pulse",
  thinking: "spin",
  reading: "spin",
  reconnecting: "spin",
};

// System icon stand-ins (simple line drawings, 24x24 viewBox).
const ICON_PATHS: Record<IconName, string> = {
  listening: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
  thinking: "M6 12h.01M12 12h.01M18 12h.01",
  reading:
    "M4 5.5C4 5.2 4.2 5 4.5 5H11a1 1 0 0 1 1 1v13a2 2 0 0 0-2-2H4.5a.5.5 0 0 1-.5-.5zM20 5.5c0-.3-.2-.5-.5-.5H13a1 1 0 0 0-1 1v13a2 2 0 0 1 2-2h5.5a.5.5 0 0 0 .5-.5z",
  "hand-lost":
    "M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v7M14 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2-4a1.5 1.5 0 0 1 2.6-1.5L8 13M3 3l18 18",
  offline:
    "M2 8.8a15 15 0 0 1 4.2-2.6M5 12.5a10 10 0 0 1 5-2.3M8.5 16a5 5 0 0 1 5-1M12 20h.01M3 3l18 18",
  reconnecting: "M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3M18 3v4h-4M6 21v-4h4",
  "no-page": "M7 3h7l5 5v13H7zM14 3v5h5M10 13l4 4M14 13l-4 4",
  "no-word": "M5 3l13 6.5-5.5 2L10 17z",
  "load-failed":
    "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  "not-found": "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M8 11h6",
};

function Icon({ name }: { name: IconName }) {
  const ring = RING[name];
  if (ring) return <span className={styles.ring} data-motion={ring} aria-hidden="true" />;
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

function Node({ node }: { node: SceneNode }) {
  switch (node.type) {
    case "flex": {
      const style: CSSProperties = {
        flexDirection: node.direction,
        gap: px(node.gap ?? 0),
        alignItems: ALIGN[node.align ?? "start"],
        justifyContent: JUSTIFY[node.justify ?? "start"],
        flexWrap: node.wrap ? "wrap" : "nowrap",
      };
      return (
        <div
          className={styles.flex}
          style={style}
          data-surface={node.surface ?? "none"}
          data-tone={node.tone ?? "default"}
        >
          {node.children.map((child, i) => (
            <Node key={i} node={child} />
          ))}
        </div>
      );
    }
    case "text":
      return (
        <span className={styles.text} data-preset={node.preset} data-tone={node.tone ?? "default"}>
          {node.text}
        </span>
      );
    case "image":
      return (
        <img
          className={styles.image}
          src={node.url}
          alt=""
          style={{ width: px(node.width), height: px(node.height), borderRadius: px(node.radius) }}
        />
      );
    case "placeholder":
      return (
        <div
          className={styles.placeholder}
          role="status"
          aria-label={node.label}
          style={{ width: px(node.width), height: px(node.height), borderRadius: px(node.radius) }}
        >
          <span className={styles.placeholderLabel}>{node.label}</span>
        </div>
      );
    case "button":
      return (
        <span className={styles.button} data-focused={node.focused}>
          {node.label}
        </span>
      );
    case "icon":
      return <Icon name={node.name} />;
  }
}

export function ScenePanel({ scene }: { scene: Scene }) {
  return <div className={styles.scene}>{scene && <Node node={scene} />}</div>;
}
