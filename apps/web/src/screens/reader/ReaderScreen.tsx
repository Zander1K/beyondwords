// Reader: one view. The live camera (the glasses' eyes) fills it, can go fullscreen, and the
// simulated glasses display floats on top in the right-lens position. Everything else is glass
// over the camera: status pills (top left), issue messages where a problem is (top centre), a
// dock of actions (bottom), and a Controls sheet that slides in from the right. The controls
// show and hide with the Controls button, the C key, or by holding thumb and little finger out to the camera.
// The page is read continuously from the live camera: frame -> OCR -> page analysis (MOCK) ->
// merged into the page; the fingertip picks the exact word every frame. A demo page is shown
// until the first read (HACK, so the glasses have something before the camera starts).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { GlassesHudLayer, useControlsShortcut } from "@/glasses";
import { currentPhrase } from "@/reader";
import { useReaderStore } from "@/state";

import { CameraView } from "./CameraView";
import { ControlsHint } from "./ControlsHint";
import { ControlsSheet } from "./ControlsSheet";
import { deriveIssues, derivePills, type Issue } from "./health";
import styles from "./ReaderScreen.module.css";
import { IssueStack, StatusPills } from "./ReaderStatus";
import { useCamera } from "./useCamera";
import { useFullscreen } from "./useFullscreen";
import { useHandTracking } from "./useHandTracking";
import { useLiveScan } from "./useLiveScan";
import { useReaderController } from "./useReaderController";
import { type OverlayHand, VisionOverlay } from "./VisionOverlay";

export function ReaderScreen() {
  const r = useReaderController();
  const cam = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(viewerRef);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [skeleton, setSkeleton] = useState(false);
  const [boxes, setBoxes] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const scan = useReaderStore((s) => s.scan);
  const handLost = useReaderStore((s) => s.handLost);
  const live = cam.stream !== null;

  const toggleControls = useCallback(() => setControlsOpen((open) => !open), []);
  const tracking = useHandTracking(videoRef, live, toggleControls);

  // The C key does the same as the hand gesture.
  useControlsShortcut(toggleControls);

  // The page is read continuously from the live view (no Scan button); lines under the hand
  // keep their last reading, so the scanner needs to know where the hands are.
  const handsRef = useRef<readonly OverlayHand[]>([]);
  useEffect(() => {
    handsRef.current = tracking.hands;
  }, [tracking.hands]);
  useLiveScan(videoRef, live, handsRef);

  // What is working and what is not, shown where it matters.
  const health = useMemo(
    () => ({
      camera: cam.camera,
      session: r.session,
      asleep: r.asleep,
      offline: r.offline,
      scan,
      tracking: tracking.stats,
      handLost,
    }),
    [cam.camera, r.session, r.asleep, r.offline, scan, tracking.stats, handLost],
  );
  const pills = useMemo(() => derivePills(health), [health]);
  const issues = useMemo(() => {
    const list: Issue[] = deriveIssues(health);
    // One-off notices (call interrupted, glasses disconnected) can be closed.
    const notice = r.notice;
    if (notice && notice.text !== dismissed) {
      list.push({
        id: "notice",
        severity: notice.tone === "warn" ? "warn" : "info",
        title: notice.text,
        dismissible: true,
      });
    }
    return list;
  }, [health, r.notice, dismissed]);

  const phoneCaption = r.offline ? currentPhrase(r.page, r.reader.position)?.text : undefined;

  return (
    <div
      ref={viewerRef}
      className={styles.viewer}
      data-fullscreen={fullscreen.mode}
      data-controls={controlsOpen ? "open" : "closed"}
    >
      <CameraView camera={cam.camera} videoRef={videoRef} onStart={() => void cam.start()}>
        <VisionOverlay
          page={r.page}
          position={r.reader.position}
          hands={tracking.hands}
          showSkeleton={skeleton}
          showBoxes={boxes}
          connections={tracking.connections}
        />
      </CameraView>

      <GlassesHudLayer />

      <div className={styles.topBar}>
        <StatusPills pills={pills} />
      </div>

      {phoneCaption && (
        // SIM-SES-05: glasses offline, so the phone shows the phrase instead.
        <div className={styles.phoneCaption} role="status">
          <span className={styles.phoneLabel}>Glasses offline · on the phone</span>
          <span>{phoneCaption}</span>
          <div className={styles.phoneNav}>
            <button
              type="button"
              className={styles.phoneButton}
              onClick={() => r.actions.phone("up")}
              aria-label="Previous line"
            >
              ↑
            </button>
            <button
              type="button"
              className={styles.phoneButton}
              onClick={() => r.actions.phone("left")}
              aria-label="Previous phrase"
            >
              ←
            </button>
            <button
              type="button"
              className={styles.phoneButton}
              onClick={() => r.actions.phone("right")}
              aria-label="Next phrase"
            >
              →
            </button>
            <button
              type="button"
              className={styles.phoneButton}
              onClick={() => r.actions.phone("down")}
              aria-label="Next line"
            >
              ↓
            </button>
          </div>
        </div>
      )}

      {/* Issues, the controls hint and the dock stack in one column, so they never overlap
          when the dock wraps on a narrow screen. */}
      <div className={styles.bottom}>
        <IssueStack
          issues={issues}
          onAction={(id) => {
            if (id === "retry-hands") tracking.retry();
          }}
          onDismiss={(id) => {
            if (id === "notice" && r.notice) setDismissed(r.notice.text);
          }}
        />

        <ControlsHint
          open={controlsOpen}
          cameraOn={live}
          progress={tracking.holdProgress}
          onToggle={toggleControls}
        />

        <div className={styles.dock} role="toolbar" aria-label="Reading actions">
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
              className={styles.button}
              onClick={() => void r.actions.stopSession()}
              disabled={r.session !== "started"}
            >
              Stop reading
            </button>
          )}
          {live ? (
            <button type="button" className={styles.button} onClick={cam.stop}>
              Camera off
            </button>
          ) : (
            <button
              type="button"
              className={styles.button}
              onClick={() => void cam.start()}
              disabled={cam.camera.kind === "starting"}
            >
              Camera on
            </button>
          )}
          <button
            type="button"
            className={styles.button}
            onClick={toggleControls}
            aria-expanded={controlsOpen}
            aria-controls="reader-controls"
          >
            Controls
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={fullscreen.toggle}
            aria-pressed={fullscreen.mode !== "off"}
          >
            {fullscreen.mode === "off" ? "Fullscreen" : "Exit fullscreen"}
          </button>
        </div>
      </div>

      <ControlsSheet
        open={controlsOpen}
        onClose={() => setControlsOpen(false)}
        page={r.page}
        position={r.reader.position}
        sessionStopped={r.session === "stopped"}
        offline={r.offline}
        showSkeleton={skeleton}
        onSkeleton={setSkeleton}
        showBoxes={boxes}
        onBoxes={setBoxes}
      />
    </div>
  );
}
