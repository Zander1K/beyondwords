// SIM-GST-01/02: the six-action gesture pad and the gesture log.
// Buttons call the adapter like a Neural Band / touchpad gesture would; keys are handled inside
// the adapter. Press feedback comes from the adapter's gesture log, so keys and buttons light
// up the same way. The pulse stands in for the band's haptic tap (no real haptics).
import { useStore } from "zustand";

import type { GlassesGesture } from "../adapter";
import { GESTURE_KEYS } from "../web-simulator/gestures";
import type { WebSimulatorAdapter } from "../web-simulator/WebSimulatorAdapter";
import styles from "./GesturePad.module.css";

const REAL_GESTURE: Record<GlassesGesture, string> = {
  select: "thumb-index pinch",
  back: "thumb-middle pinch",
  left: "thumb swipe left",
  right: "thumb swipe right",
  up: "thumb swipe up",
  down: "thumb swipe down",
};

// D-pad layout: grid areas.
const LAYOUT: ReadonlyArray<{ gesture: GlassesGesture; area: string }> = [
  { gesture: "up", area: "up" },
  { gesture: "left", area: "left" },
  { gesture: "select", area: "select" },
  { gesture: "right", area: "right" },
  { gesture: "down", area: "down" },
  { gesture: "back", area: "back" },
];

function PadButton({
  adapter,
  gesture,
  area,
  pressedAt,
}: {
  adapter: WebSimulatorAdapter;
  gesture: GlassesGesture;
  area: string;
  pressedAt: number | null;
}) {
  return (
    <button
      type="button"
      className={styles.padButton}
      style={{ gridArea: area }}
      data-pressed={pressedAt !== null}
      onClick={() => adapter.emitGesture(gesture, "pad")}
      title={REAL_GESTURE[gesture]}
    >
      <span className={styles.action}>{gesture}</span>
      <kbd>{GESTURE_KEYS[gesture]}</kbd>
    </button>
  );
}

export function GesturePad({ adapter }: { adapter: WebSimulatorAdapter }) {
  const log = useStore(adapter.store, (s) => s.gestureLog);
  const latest = log[0] ?? null;

  return (
    <div className={styles.wrap}>
      <div className={styles.pad} role="group" aria-label="Gesture pad">
        {LAYOUT.map(({ gesture, area }) => (
          <PadButton
            // Re-keyed on every press of this gesture so the press animation restarts.
            key={`${gesture}-${latest?.gesture === gesture ? latest.at : 0}`}
            adapter={adapter}
            gesture={gesture}
            area={area}
            pressedAt={latest?.gesture === gesture ? latest.at : null}
          />
        ))}
        {latest && <span key={latest.at} className={styles.haptic} aria-hidden="true" />}
      </div>
      <p className={styles.note}>
        Use gestures between lines, or wear the band on the hand you are not pointing with: you
        cannot pinch while pointing.
      </p>
      <div className={styles.log}>
        <span className={styles.logTitle}>Gesture log</span>
        {log.length === 0 ? (
          <p className={styles.empty}>No gestures yet.</p>
        ) : (
          <ol className={styles.entries} aria-label="Gesture log">
            {log.map((entry) => (
              <li key={`${entry.at}-${entry.gesture}-${entry.source}`} data-result={entry.result}>
                <time>{new Date(entry.at).toLocaleTimeString()}</time>
                <strong>{entry.gesture}</strong>
                <span>{entry.source}</span>
                {entry.result !== "delivered" && <em>{entry.result}</em>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
