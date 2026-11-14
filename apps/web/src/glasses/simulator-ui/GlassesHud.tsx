// The simulated Ray-Ban Display drawn over the live camera view, the way the wearer sees it:
// a 600x600 display in the right lens on top of the world. Black is see-through on the real
// display, so the scene is just its frosted cards and pills floating on the camera image; faint
// corner marks show where the 600x600 field is.
// HACK: size and position (upper right) are illustrative. OPEN QUESTION: real FOV (~20 deg) and
// placement in the lens (SIMULATION_FEATURES.md SIM-DSP-08, section 9).
import { useStore } from "zustand";

import type { WebSimulatorAdapter } from "../web-simulator/WebSimulatorAdapter";
import styles from "./GlassesHud.module.css";
import { ScenePanel } from "./ScenePanel";

export function GlassesHud({ adapter }: { adapter: WebSimulatorAdapter }) {
  const scene = useStore(adapter.store, (s) => s.scene);
  const session = useStore(adapter.store, (s) => s.session);
  const audioOnly = useStore(adapter.store, (s) => s.audioOnly);
  const sleep = useStore(adapter.store, (s) => s.sleep);
  const connected = useStore(adapter.store, (s) => s.connected);
  const lastCue = useStore(adapter.store, (s) => s.lastCue);

  const off = !connected || session !== "started";

  return (
    <div className={styles.hud} aria-label="Glasses display (right lens)">
      <div
        className={styles.display}
        data-testid="glasses-display"
        data-sleep={sleep}
        data-off={off || audioOnly}
        aria-live="polite"
      >
        {audioOnly ? (
          <span className={styles.caption}>No display · audio only (Gen 2)</span>
        ) : off ? (
          <span className={styles.caption} data-error={!connected}>
            {connected ? "Glasses display off" : "Glasses disconnected"}
          </span>
        ) : (
          sleep !== "asleep" && <ScenePanel scene={scene} />
        )}
      </div>
      {lastCue && (
        // Keyed by time so the fade restarts on every cue (visible with the sound off).
        <span key={lastCue.at} className={styles.cue} role="status">
          ♪ {lastCue.kind}
        </span>
      )}
    </div>
  );
}
