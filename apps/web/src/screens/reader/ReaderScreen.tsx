// Reader: demo phrases driven by glasses gestures, shown on the (simulated) glasses display.
// HACK: hard-coded demo phrases until the page capture -> OCR -> /pages/analyze slice exists.
import { GlassesPanel } from "@/glasses";
import { DEMO_PHRASES } from "@/reader";

import { CameraPanel } from "./CameraPanel";
import styles from "./ReaderScreen.module.css";
import { useReaderController } from "./useReaderController";

export function ReaderScreen() {
  const r = useReaderController();

  return (
    <div className={styles.reader}>
      <section className={styles.page} aria-label="Page">
        <h1>Reader</h1>
        <div className={styles.actions}>
          {r.session === "stopped" ? (
            <button type="button" onClick={() => void r.actions.startSession()}>
              Start session
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void r.actions.stopSession()}
              disabled={r.session !== "started"}
            >
              {r.session === "started" ? "Stop session" : `${r.session}…`}
            </button>
          )}
        </div>
        <p className={styles.text}>
          {DEMO_PHRASES.map((p, i) => (
            <span key={p.text} className={i === r.reader.index ? styles.current : undefined}>
              {p.text}{" "}
            </span>
          ))}
        </p>
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
