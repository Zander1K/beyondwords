// Reader: one view. The live camera (the glasses' eyes) fills it, can go fullscreen, and the
// simulated glasses display floats on top in the right-lens position. Status sits in a slim top
// bar, actions in a bottom bar, and everything else in a Controls sheet inside the view (so it
// also works in fullscreen).
// The page comes from the camera: still -> OCR -> page analysis (MOCK). A demo page is shown
// until the first scan (HACK, so the glasses have something before the camera starts).
import { useEffect, useRef, useState } from "react";

import { GlassesControlsPanel, GlassesHudLayer } from "@/glasses";
import { currentPhrase } from "@/reader";
import { type ScanState, useReaderStore } from "@/state";

import { CameraView } from "./CameraView";
import styles from "./ReaderScreen.module.css";
import { useCamera } from "./useCamera";
import { useFullscreen } from "./useFullscreen";
import { type TrackingStats, useHandTracking } from "./useHandTracking";
import { usePageScan } from "./usePageScan";
import { useReaderController } from "./useReaderController";
import { VisionOverlay } from "./VisionOverlay";

const SESSION_LABEL = {
  stopped: "Glasses off",
  starting: "Starting…",
  started: "Reading",
  stopping: "Stopping…",
} as const;

/** Wait for the camera to settle (exposure, focus) before the first page still. [ASSUMPTION] */
const FIRST_SCAN_DELAY_MS = 1500;
/** Wait up to this long for a hand-free view, so fingers do not hide words in the still. */
const HAND_FREE_WAIT_MS = 4000;

function TrackingReadout({ stats, handLost }: { stats: TrackingStats; handLost: boolean }) {
  if (stats.status === "off") return null;
  if (stats.status === "loading") return <span>Hands: loading…</span>;
  if (stats.status === "error") return <span role="alert">Hands: unavailable</span>;
  return (
    <span data-alert={handLost}>
      {handLost ? "Hand lost · holding line" : `Hands ${stats.fps} fps · ${stats.detectMs} ms`}
    </span>
  );
}

function ScanReadout({ scan }: { scan: ScanState }) {
  switch (scan.status) {
    case "idle":
      return <span>Page: demo text</span>;
    case "scanning":
      return <span>Reading page…</span>;
    case "ready":
      return (
        <span>
          {scan.lines} lines · OCR {scan.ocrMs} ms
        </span>
      );
    case "empty":
      return <span data-alert="true">No text found · scan again</span>;
    case "error":
      return <span data-alert="true">{scan.message}</span>;
  }
}

export function ReaderScreen() {
  const r = useReaderController();
  const cam = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fullscreen = useFullscreen(viewerRef);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [skeleton, setSkeleton] = useState(false);
  const scan = useReaderStore((s) => s.scan);
  const handLost = useReaderStore((s) => s.handLost);
  usePageScan(cam.still);
  const live = cam.stream !== null;
  const tracking = useHandTracking(videoRef, live);
  const { line, phrase } = r.reader.position;

  // SIM-CAM-02: take a page still automatically once the camera is running, preferably while
  // no hand is in view. TODO(alex): also on page change (SIM-VIS-05, P1).
  const handsInView = useRef(0);
  useEffect(() => {
    handsInView.current = tracking.hands.length;
  }, [tracking.hands]);
  const { stream, capture } = cam;
  useEffect(() => {
    if (!stream) return;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      const waited = Date.now() - started;
      if (handsInView.current > 0 && waited < FIRST_SCAN_DELAY_MS + HAND_FREE_WAIT_MS) {
        timer = setTimeout(attempt, 250);
        return;
      }
      void capture();
    };
    timer = setTimeout(attempt, FIRST_SCAN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [stream, capture]);

  const notice = cam.captureError ? { text: cam.captureError, tone: "warn" as const } : r.notice;
  const phoneCaption = r.offline ? currentPhrase(r.page, r.reader.position)?.text : undefined;

  return (
    <div ref={viewerRef} className={styles.viewer} data-fullscreen={fullscreen.mode}>
      <CameraView
        camera={cam.camera}
        still={cam.still}
        flashAt={cam.flashAt}
        videoRef={videoRef}
        onStart={() => void cam.start()}
        onUpload={() => fileRef.current?.click()}
      >
        <VisionOverlay
          page={r.page}
          position={r.reader.position}
          hands={tracking.hands}
          showSkeleton={skeleton}
          connections={tracking.connections}
        />
      </CameraView>

      <GlassesHudLayer />

      <div className={styles.topBar}>
        {live ? (
          <span className={styles.live} role="status">
            <span className={styles.dot} aria-hidden="true" /> Camera on
          </span>
        ) : (
          <span>Camera off</span>
        )}
        <span className={styles.badge} data-state={r.session}>
          {SESSION_LABEL[r.session]}
          {r.asleep && " · asleep"}
        </span>
        <ScanReadout scan={scan} />
        <TrackingReadout stats={tracking.stats} handLost={handLost} />
      </div>

      {notice && (
        <p className={styles.notice} data-tone={notice.tone} role="status">
          {notice.text}
        </p>
      )}

      {phoneCaption && (
        // SIM-SES-05: glasses offline, so the phone shows the phrase instead.
        <div className={styles.phoneCaption} role="status">
          <span className={styles.phoneLabel}>Glasses offline · on the phone</span>
          <span>{phoneCaption}</span>
          <div className={styles.phoneNav}>
            <button type="button" onClick={() => r.actions.phone("up")} aria-label="Previous line">
              ↑
            </button>
            <button
              type="button"
              onClick={() => r.actions.phone("left")}
              aria-label="Previous phrase"
            >
              ←
            </button>
            <button type="button" onClick={() => r.actions.phone("right")} aria-label="Next phrase">
              →
            </button>
            <button type="button" onClick={() => r.actions.phone("down")} aria-label="Next line">
              ↓
            </button>
          </div>
        </div>
      )}

      <div className={styles.bottomBar}>
        {r.session === "stopped" ? (
          <button
            type="button"
            className={styles.primary}
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
            Stop reading
          </button>
        )}
        {live ? (
          <>
            <button type="button" onClick={() => void cam.capture()}>
              Scan page
            </button>
            <button type="button" onClick={cam.stop}>
              Camera off
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void cam.start()}
            disabled={cam.camera.kind === "starting"}
          >
            Camera on
          </button>
        )}
        <button type="button" onClick={() => fileRef.current?.click()}>
          Upload page
        </button>
        <span className={styles.spacer} />
        <button
          type="button"
          onClick={() => setControlsOpen((o) => !o)}
          aria-expanded={controlsOpen}
          aria-controls="reader-controls"
        >
          Controls
        </button>
        <button type="button" onClick={fullscreen.toggle} aria-pressed={fullscreen.mode !== "off"}>
          {fullscreen.mode === "off" ? "Fullscreen" : "Exit fullscreen"}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        aria-label="Upload a page photo"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            cam.stop();
            cam.upload(file);
          }
          e.target.value = "";
        }}
      />

      {controlsOpen && (
        <aside id="reader-controls" className={styles.sheet} aria-label="Controls">
          <div className={styles.sheetHeader}>
            <h2>Controls</h2>
            <button type="button" onClick={() => setControlsOpen(false)}>
              Close
            </button>
          </div>

          <section className={styles.section}>
            <h3>Page</h3>
            {r.session === "stopped" && !r.offline && (
              <p className={styles.hint}>
                Press Start reading: the glasses display session needs your go-ahead.
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
          </section>

          <section className={styles.section}>
            <h3>Camera view</h3>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={skeleton}
                onChange={(e) => setSkeleton(e.target.checked)}
              />
              Show hand skeleton
            </label>
            <p className={styles.hint}>
              Frames and photos stay in this browser tab: nothing is saved or uploaded.
            </p>
          </section>

          <section className={styles.section}>
            <h3>Glasses simulator</h3>
            <GlassesControlsPanel />
          </section>
        </aside>
      )}
    </div>
  );
}
