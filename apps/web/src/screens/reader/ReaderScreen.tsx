// Reader: demo phrases driven by glasses input (Neural Band, touchpad, capture button, voice),
// shown on the (simulated) glasses display, with the glasses camera alongside.
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
        {r.paused && (
          <p className={styles.paused} role="status">
            {!r.device.connected
              ? "Glasses disconnected. Reading is paused."
              : r.device.folded
                ? "Glasses folded. Reading is paused."
                : "Glasses taken off. Reading is paused until you put them back on."}
          </p>
        )}
        <p className={styles.hint}>
          Move with <kbd>←</kbd> <kbd>→</kbd>, <kbd>Enter</kbd> for the word, <kbd>Esc</kbd> to go
          back, <kbd>Space</kbd> to read aloud, <kbd>C</kbd> to capture, <kbd>V</kbd> to speak a
          command. The simulator panel lists every control.
        </p>
        <p className={styles.text}>
          {DEMO_PHRASES.map((p, i) => (
            <span key={p.text} className={i === r.reader.index ? styles.current : undefined}>
              {p.text}{" "}
            </span>
          ))}
        </p>
        <div className={styles.actions}>
          <button type="button" onClick={r.actions.toggleRead}>
            {r.speaking ? "Stop reading" : "Read this phrase aloud"}
          </button>
          <button type="button" onClick={() => void r.actions.listen()}>
            Speak a command
          </button>
        </div>
        {r.heard && (
          <p className={styles.heard}>
            Heard: “{r.heard.text}” →{" "}
            {r.heard.command.kind === "define"
              ? `define "${r.heard.command.word}"`
              : r.heard.command.kind === "unknown"
                ? "question for the assistant (not connected yet)"
                : r.heard.command.kind}
          </p>
        )}
        {r.notice && (
          <p className={r.notice.tone === "warn" ? styles.warn : styles.info} role="status">
            {r.notice.text}
          </p>
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
          cameraOn={r.cameraOn}
          stoppedByDevice={r.cameraStoppedByDevice}
          capture={r.capture}
          onStart={() => void r.actions.startCamera()}
          onStop={r.actions.stopCamera}
          onCapture={() => void r.actions.capturePage()}
          onViewfinder={r.actions.showViewfinder}
        />
      </section>
    </div>
  );
}
