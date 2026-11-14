// Reader: one view. The live camera (the glasses' eyes) fills it, can go fullscreen, and the
// simulated glasses display floats on top in the right-lens position. Status sits in a slim top
// bar, actions in a bottom bar, and everything else in a Controls sheet inside the view (so it
// also works in fullscreen).
// The page is read continuously from the live camera: frame -> OCR -> page analysis (MOCK) ->
// merged into the page; the fingertip picks the exact word every frame. A demo page is shown
// until the first read (HACK, so the glasses have something before the camera starts).
import { useEffect, useRef, useState } from "react";

import { GlassesControlsPanel, GlassesHudLayer } from "@/glasses";
import { currentPhrase } from "@/reader";
import { type ScanState, useReaderStore } from "@/state";

import { CameraView } from "./CameraView";
import styles from "./ReaderScreen.module.css";
import { useCamera } from "./useCamera";
import { useFullscreen } from "./useFullscreen";
import { type TrackingStats, useHandTracking } from "./useHandTracking";
import { useLiveScan } from "./useLiveScan";
import { useReaderController } from "./useReaderController";
import { type OverlayHand, VisionOverlay } from "./VisionOverlay";

const SESSION_LABEL = {
  stopped: "Glasses off",
  starting: "Starting…",
  started: "Reading",
  stopping: "Stopping…",
} as const;

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
    case "live":
      return (
        <span>
          Live text: {scan.lines} lines · {scan.ocrMs} ms/read
          {scan.unwarped && " · flattened"}
        </span>
      );
    case "empty":
      return <span data-alert="true">No text in view · aim at the page</span>;
    case "error":
      return <span data-alert="true">{scan.message}</span>;
  }
}

export function ReaderScreen() {
  const r = useReaderController();
  const cam = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(viewerRef);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [skeleton, setSkeleton] = useState(false);
  const scan = useReaderStore((s) => s.scan);
  const handLost = useReaderStore((s) => s.handLost);
  const live = cam.stream !== null;
  const tracking = useHandTracking(videoRef, live);
  const { line, phrase } = r.reader.position;

  // The page is read continuously from the live view (no Scan button); lines under the hand
  // keep their last reading, so the scanner needs to know where the hands are.
  const handsRef = useRef<readonly OverlayHand[]>([]);
  useEffect(() => {
    handsRef.current = tracking.hands;
  }, [tracking.hands]);
  useLiveScan(videoRef, live, handsRef);

  const notice = r.notice;
  const phoneCaption = r.offline ? currentPhrase(r.page, r.reader.position)?.text : undefined;

  return (
    <div ref={viewerRef} className={styles.viewer} data-fullscreen={fullscreen.mode}>
      <CameraView camera={cam.camera} videoRef={videoRef} onStart={() => void cam.start()}>
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
              Camera frames stay in this browser tab: nothing is saved or uploaded.
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
