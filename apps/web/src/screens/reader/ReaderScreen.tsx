// Reader: the live camera view is the main stage (the glasses' eyes), the simulated glasses
// display beside it, and the phone view of the page (source of truth) below.
// HACK: demo page until the camera page scan (OCR + mock /pages/analyze) replaces it.
import { useEffect, useRef } from "react";

import { GlassesPanel } from "@/glasses";

import { CameraStage } from "./CameraStage";
import styles from "./ReaderScreen.module.css";
import { useCamera } from "./useCamera";
import { useReaderController } from "./useReaderController";

const SESSION_LABEL = {
  stopped: "Stopped",
  starting: "Starting…",
  started: "Reading",
  stopping: "Stopping…",
} as const;

/** Wait for the camera to settle (exposure, focus) before the first page still. [ASSUMPTION] */
const FIRST_SCAN_DELAY_MS = 1500;

export function ReaderScreen() {
  const r = useReaderController();
  const cam = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const { line, phrase } = r.reader.position;

  // SIM-CAM-02: take a page still automatically once the camera is running.
  // TODO(alex): also on page change (SIM-VIS-05, P1).
  const { stream, capture } = cam;
  useEffect(() => {
    if (!stream) return;
    const timer = setTimeout(() => void capture(), FIRST_SCAN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [stream, capture]);

  return (
    <div className={styles.reader}>
      <div className={styles.controlStrip}>
        <span className={styles.badge} data-state={r.session} role="status">
          Session: {SESSION_LABEL[r.session]}
          {r.asleep && " (display asleep)"}
        </span>
        {r.session === "stopped" ? (
          <button type="button" onClick={() => void r.actions.startSession()} disabled={r.offline}>
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
        {r.notice && (
          <span className={r.notice.tone === "warn" ? styles.warn : styles.info} role="status">
            {r.notice.text}
          </span>
        )}
      </div>

      <div className={styles.stageRow}>
        <section className={styles.camera} aria-label="Camera view">
          <h2>Camera view</h2>
          <CameraStage
            camera={cam.camera}
            still={cam.still}
            flashAt={cam.flashAt}
            captureError={cam.captureError}
            videoRef={videoRef}
            onStart={() => void cam.start()}
            onStop={cam.stop}
            onCapture={() => void cam.capture()}
            onUpload={cam.upload}
          />
        </section>

        <section className={styles.glasses} aria-label="Glasses">
          <h2>Glasses display</h2>
          <GlassesPanel />
        </section>
      </div>

      <section className={styles.page} aria-label="Page">
        <h2>Page (phone view)</h2>
        {r.session === "stopped" && !r.offline && (
          <p className={styles.hint}>
            Reading starts when you press Start (the glasses display session needs your go-ahead).
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
    </div>
  );
}
