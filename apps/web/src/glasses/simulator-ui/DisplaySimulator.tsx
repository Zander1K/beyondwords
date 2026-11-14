// Glasses simulator panel: the Ray-Ban Display (600x600 in a right-lens frame), session controls,
// the six-action gesture pad and audio-only mode.
// HACK: the lens frame proportions and the display's offset inside it are illustrative only.
import { useStore } from "zustand";

import type { GlassesGesture } from "../adapter";
import { GESTURE_KEYS } from "../web-simulator/gestures";
import type { WebSimulatorAdapter } from "../web-simulator/WebSimulatorAdapter";
import type { DisplayContent } from "./displayModel";
import styles from "./DisplaySimulator.module.css";

const PAD: readonly GlassesGesture[] = ["left", "select", "right", "up", "back", "down"];

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
  const session = useStore(adapter.store, (s) => s.session);
  const content = useStore(adapter.store, (s) => s.content);
  const audioOnly = useStore(adapter.store, (s) => s.audioOnly);
  const lastCue = useStore(adapter.store, (s) => s.lastCue);

  return (
    <section className={styles.simulator} aria-label="Glasses simulator">
      <div className={styles.frameBar}>
        <span className={styles.frameText}>Session: {session}</span>
      </div>

      <div className={styles.lens}>
        <span className={styles.lensLabel}>Right lens · 600×600</span>
        <div className={styles.display} data-testid="glasses-display" aria-live="polite">
          {!audioOnly && content && <Content content={content} />}
        </div>
        {lastCue && (
          <span key={lastCue.at} className={styles.cue} role="status">
            ♪ {lastCue.kind}
          </span>
        )}
      </div>

      <div className={styles.controls}>
        <fieldset className={styles.group}>
          <legend>Gestures (Neural Band / touchpad)</legend>
          <div className={styles.inputs}>
            {PAD.map((g) => (
              <button
                key={g}
                type="button"
                className={styles.inputButton}
                onClick={() => adapter.emitGesture(g)}
              >
                {g} <kbd>{GESTURE_KEYS[g]}</kbd>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className={styles.group}>
          <legend>Mode</legend>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={audioOnly}
              onChange={(e) => adapter.setAudioOnly(e.target.checked)}
            />
            Audio-only (Ray-Ban Meta Gen 2)
          </label>
        </fieldset>
      </div>
    </section>
  );
}
