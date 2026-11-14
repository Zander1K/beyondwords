// Glasses simulator controls (the display itself is GlassesHud, over the camera view): device
// status, camera gestures and the six-action gesture pad with its log, system events, display
// stats and audio-only mode.
import { useStore } from "zustand";

import type { WebSimulatorAdapter } from "../web-simulator/WebSimulatorAdapter";
import styles from "./GlassesControls.module.css";
import { GesturePad } from "./GesturePad";

/** SIM-DSP-04 stress test: 50 phrase updates per second for 2 s. */
function stressTest(adapter: WebSimulatorAdapter): void {
  let n = 0;
  const timer = setInterval(() => {
    adapter.showPhrase(`Stress update ${++n}`);
    if (n >= 100) clearInterval(timer);
  }, 20);
}

function UpdateInfo({ adapter }: { adapter: WebSimulatorAdapter }) {
  const count = useStore(adapter.store, (s) => s.updateCount);
  const at = useStore(adapter.store, (s) => s.lastUpdateAt);
  return (
    <span className={styles.frameText} data-testid="display-updates">
      Updates: {count}
      {at !== null && ` · last ${new Date(at).toLocaleTimeString()}`}
    </span>
  );
}

interface Props {
  adapter: WebSimulatorAdapter;
  /** Tear down and recreate the adapter (SIM-SES-07: reading position must survive). */
  onRecreate: () => void;
}

function CameraGestureToggles({ adapter }: { adapter: WebSimulatorAdapter }) {
  const on = useStore(adapter.store, (s) => s.cameraGestures);
  const mirrored = useStore(adapter.store, (s) => s.cameraGesturesMirrored);
  return (
    <div className={styles.cameraGestures}>
      <p className={styles.note}>
        From the camera: <strong>thumb + index pinch</strong> = select,{" "}
        <strong>thumb + middle pinch</strong> = back, <strong>open-palm swipe</strong> = left /
        right / up / down. A pointing finger is the reading cursor. Keys and the pad below are a
        fallback.
      </p>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => adapter.setCameraGestures(e.target.checked)}
        />
        Camera gestures
      </label>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={mirrored}
          onChange={(e) => adapter.setCameraGesturesMirrored(e.target.checked)}
        />
        Mirror swipes (camera facing me)
      </label>
    </div>
  );
}

export function GlassesControls({ adapter, onRecreate }: Props) {
  const session = useStore(adapter.store, (s) => s.session);
  const maxRate = useStore(adapter.store, (s) => s.maxUpdatesPerSecond);
  const warnings = useStore(adapter.store, (s) => s.warnings);
  const audioOnly = useStore(adapter.store, (s) => s.audioOnly);
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
        <UpdateInfo adapter={adapter} />
      </div>

      <div className={styles.controls}>
        <fieldset className={styles.group}>
          <legend>Gestures (Neural Band / touchpad)</legend>
          <CameraGestureToggles adapter={adapter} />
          <GesturePad adapter={adapter} />
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
          <legend>Display</legend>
          <label className={styles.slider}>
            Max {maxRate} updates per second
            <input
              type="range"
              min={1}
              max={20}
              value={maxRate}
              onChange={(e) => adapter.setMaxUpdatesPerSecond(Number(e.target.value))}
            />
          </label>
          <button type="button" onClick={() => stressTest(adapter)} disabled={!started}>
            Stress test (50 updates/s for 2 s)
          </button>
          {warnings.length > 0 && (
            <ul className={styles.warnings} aria-label="Display warnings">
              {warnings.slice(0, 4).map((w) => (
                <li key={`${w.at}-${w.message}`}>{w.message}</li>
              ))}
            </ul>
          )}
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
