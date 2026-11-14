// Reader: the phone view of the page (source of truth), the simulated glasses, and the camera.
// HACK: demo page until the page capture -> OCR -> /pages/analyze slice exists.
import { GlassesPanel } from "@/glasses";

import { CameraPanel } from "./CameraPanel";
import styles from "./ReaderScreen.module.css";
import { useReaderController } from "./useReaderController";

const SESSION_LABEL = {
  stopped: "Stopped",
  starting: "Starting…",
  started: "Reading",
  stopping: "Stopping…",
} as const;

export function ReaderScreen() {
  const r = useReaderController();
  const { line, phrase } = r.reader.position;

  return (
    <div className={styles.reader}>
      <section className={styles.page} aria-label="Page">
        <h1>Reader</h1>
        <div className={styles.actions}>
          <span className={styles.badge} data-state={r.session} role="status">
            Session: {SESSION_LABEL[r.session]}
            {r.asleep && " (display asleep)"}
          </span>
          {r.session === "stopped" ? (
            <button
              type="button"
              onClick={() => void r.actions.startSession()}
              disabled={r.offline}
            >
              Start reading
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void r.actions.stopSession()}
              disabled={r.session !== "started"}
            >
              Stop
            </button>
          )}
        </div>
        {r.session === "stopped" && !r.offline && (
          <p className={styles.hint}>
            Reading starts when you press Start (the glasses display session needs your go-ahead).
          </p>
        )}
        {r.notice && (
          <p className={r.notice.tone === "warn" ? styles.warn : styles.info} role="status">
            {r.notice.text}
          </p>
        )}

        <div className={styles.text}>
          {r.page.lines.map((l, li) => (
            <p key={li} className={styles.line}>
              {l.phrases.map((p, pi) => (
                <span
                  key={pi}
                  className={li === line && pi === phrase ? styles.current : undefined}
                >
                  {p.text}{" "}
                </span>
              ))}
            </p>
          ))}
        </div>

        {r.offline && (
          <div className={styles.actions} role="group" aria-label="Phone navigation">
            <button type="button" onClick={() => r.actions.phone("up")}>
              Previous line
            </button>
            <button type="button" onClick={() => r.actions.phone("left")}>
              Previous phrase
            </button>
            <button type="button" onClick={() => r.actions.phone("right")}>
              Next phrase
            </button>
            <button type="button" onClick={() => r.actions.phone("down")}>
              Next line
            </button>
          </div>
        )}
      </section>

      <section className={styles.glasses} aria-label="Glasses">
        <h2>Glasses</h2>
        <GlassesPanel />
      </section>

      <section className={styles.camera} aria-label="Camera">
        <h2>Camera</h2>
        <CameraPanel
          camera={r.camera}
          capture={r.capture}
          onStart={() => void r.actions.startCamera()}
          onStop={r.actions.stopCamera}
          onCapture={() => void r.actions.capturePage()}
        />
      </section>
    </div>
  );
}
