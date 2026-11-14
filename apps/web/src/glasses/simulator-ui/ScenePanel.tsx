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

// System icon stand-ins (simple line drawings, 24x24 viewBox).
const ICON_PATHS: Record<IconName, string> = {
  listening: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
  thinking: "M6 12h.01M12 12h.01M18 12h.01",
  "hand-lost":
    "M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v7M14 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2-4a1.5 1.5 0 0 1 2.6-1.5L8 13M3 3l18 18",
  offline:
    "M2 8.8a15 15 0 0 1 4.2-2.6M5 12.5a10 10 0 0 1 5-2.3M8.5 16a5 5 0 0 1 5-1M12 20h.01M3 3l18 18",
  reconnecting: "M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3M18 3v4h-4M6 21v-4h4",
  "no-page": "M7 3h7l5 5v13H7zM14 3v5h5M10 13l4 4M14 13l-4 4",
};

function Icon({ name }: { name: IconName }) {
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
        <div className={styles.flex} style={style}>
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
