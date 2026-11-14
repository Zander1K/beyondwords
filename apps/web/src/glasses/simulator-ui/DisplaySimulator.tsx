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

interface Props {
  adapter: WebSimulatorAdapter;
  /** Tear down and recreate the adapter (SIM-SES-07: reading position must survive). */
  onRecreate: () => void;
}

export function DisplaySimulator({ adapter, onRecreate }: Props) {
  const session = useStore(adapter.store, (s) => s.session);
  const content = useStore(adapter.store, (s) => s.content);
  const audioOnly = useStore(adapter.store, (s) => s.audioOnly);
  const lastCue = useStore(adapter.store, (s) => s.lastCue);
  const connected = useStore(adapter.store, (s) => s.connected);
  const reconnecting = useStore(adapter.store, (s) => s.reconnecting);
  const sleep = useStore(adapter.store, (s) => s.sleep);
  const interrupted = useStore(adapter.store, (s) => s.interrupted);
  const sleepTimeoutMs = useStore(adapter.store, (s) => s.sleepTimeoutMs);
  const started = session === "started";

  return (
    <section className={styles.simulator} aria-label="Glasses simulator">
      <div className={styles.frameBar}>
        <span className={styles.frameText}>Session: {session}</span>
        <span className={styles.frameText}>
          {reconnecting ? "Reconnecting…" : connected ? "Connected" : "Disconnected"}
        </span>
        <span className={styles.frameText}>Display: {sleep}</span>
      </div>

      <div className={styles.lens}>
        <span className={styles.lensLabel}>Right lens · 600×600</span>
        <div
          className={styles.display}
          data-testid="glasses-display"
          data-sleep={sleep}
          aria-live="polite"
        >
          {!audioOnly && sleep !== "asleep" && content && <Content content={content} />}
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
          <legend>System events</legend>
          <div className={styles.toggles}>
            {interrupted ? (
              <button type="button" onClick={() => void adapter.resume()}>
                Resume
              </button>
            ) : (
              <button type="button" onClick={() => void adapter.interrupt()} disabled={!started}>
                Interrupt (call)
              </button>
            )}
            {sleep === "asleep" ? (
              <button type="button" onClick={() => adapter.wake()}>
                Wake
              </button>
            ) : (
              <button type="button" onClick={() => adapter.sleepNow()} disabled={!started}>
                Sleep
              </button>
            )}
            {connected ? (
              <button type="button" onClick={() => adapter.disconnect()}>
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void adapter.reconnect()}
                disabled={reconnecting}
              >
                Reconnect
              </button>
            )}
          </div>
          <label className={styles.slider}>
            Sleep after {Math.round(sleepTimeoutMs / 1000)} s without input
            <input
              type="range"
              min={10}
              max={120}
              step={5}
              value={Math.round(sleepTimeoutMs / 1000)}
              onChange={(e) => adapter.setSleepTimeout(Number(e.target.value) * 1000)}
            />
          </label>
          <button type="button" onClick={onRecreate}>
            Recreate adapter (test)
          </button>
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
