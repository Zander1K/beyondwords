// The Ray-Ban Display simulator panel: a 600x600 display inside a right-lens field-of-view frame,
// plus the simulator's own controls (Neural Band buttons, audio-only toggle, cue indicator).
//
// HACK: the lens frame proportions and the display's offset inside it are illustrative only.
// OPEN QUESTION: exact placement of the display in the right lens (Meta display docs).
import { useStore } from "zustand";

import type { Gesture } from "../adapter";
import type { WebSimulatorAdapter } from "../web-simulator/WebSimulatorAdapter";
import type { DisplayContent } from "./displayModel";
import styles from "./DisplaySimulator.module.css";

const GESTURE_BUTTONS: ReadonlyArray<{ gesture: Gesture; label: string; key: string }> = [
  { gesture: "prev", label: "Prev", key: "←" },
  { gesture: "select", label: "Select", key: "Enter" },
  { gesture: "next", label: "Next", key: "→" },
  { gesture: "dismiss", label: "Dismiss", key: "Esc" },
];

function Content({ content }: { content: DisplayContent }) {
  switch (content.kind) {
    case "phrase": {
      if (!content.emphasis) return <p className={styles.phrase}>{content.text}</p>;
      const [start, end] = content.emphasis;
      return (
        <p className={styles.phrase}>
          {content.text.slice(0, start)}
          <mark className={styles.emphasis}>{content.text.slice(start, end)}</mark>
          {content.text.slice(end)}
        </p>
      );
    }
    case "word":
      return (
        <div className={styles.wordCard}>
          <p className={styles.word}>{content.word}</p>
          <p className={styles.short}>{content.short}</p>
        </div>
      );
    case "image":
      return <img className={styles.image} src={content.url} alt="" />;
  }
}

export function DisplaySimulator({ adapter }: { adapter: WebSimulatorAdapter }) {
  const content = useStore(adapter.store, (s) => s.content);
  const audioOnly = useStore(adapter.store, (s) => s.audioOnly);
  const lastCue = useStore(adapter.store, (s) => s.lastCue);

  return (
    <section className={styles.simulator} aria-label="Glasses simulator">
      <div className={styles.lens}>
        <span className={styles.lensLabel}>Right lens · ~20° FOV</span>
        <div
          className={styles.display}
          data-testid="glasses-display"
          aria-live="polite"
          aria-label={audioOnly ? "Display off (audio-only mode)" : "Glasses display"}
        >
          {!audioOnly && content && <Content content={content} />}
        </div>
        {lastCue && (
          // Keyed by time so the fade animation restarts on every cue.
          <span key={lastCue.at} className={styles.cue} role="status">
            ♪ {lastCue.kind}
          </span>
        )}
      </div>

      <div className={styles.controls}>
        <div className={styles.gestures} role="group" aria-label="Neural Band gestures">
          {GESTURE_BUTTONS.map(({ gesture, label, key }) => (
            <button key={gesture} type="button" onClick={() => adapter.emitGesture(gesture)}>
              {label} <kbd>{key}</kbd>
            </button>
          ))}
        </div>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={audioOnly}
            onChange={(e) => adapter.setAudioOnly(e.target.checked)}
          />
          Audio-only mode (Ray-Ban Meta Gen 2, no display)
        </label>
      </div>
    </section>
  );
}
