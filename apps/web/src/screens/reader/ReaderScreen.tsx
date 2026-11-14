// Reader: one view. The live camera (the glasses' eyes) fills it, can go fullscreen, and the
// simulated glasses display floats on top in the right-lens position. Everything else is glass
// over the camera: status pills (top left), issue messages where a problem is (top centre), a
// dock of actions (bottom), and a Controls sheet that slides in from the right. The controls
// show and hide with the Controls button, the C key, or by holding thumb and little finger out to the camera.
// A second, streamlined mode (the Ebook switch in the dock) reads an embedded ebook with the mouse
// cursor as the pointer: no camera, OCR or hand tracking; the same highlight, word card and glasses
// display. The mode is remembered for the session.
// The page is read continuously from the live camera: frame -> OCR -> page analysis (MOCK) ->
// merged into the page; the fingertip picks the exact word every frame. Until the camera has read
// some text there is no page, and the display shows nothing.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { GlassesHudLayer, useControlsShortcut } from "@/glasses";
import { currentPhrase, EMPTY_PAGE } from "@/reader";
import { useBooks, useReaderStore } from "@/state";

import { CameraView } from "./CameraView";
import { EbookView } from "./EbookView";
import { PageHint } from "./PageHint";
import { ControlsHint } from "./ControlsHint";
import { ControlsSheet } from "./ControlsSheet";
import { deriveIssues, derivePills, type Issue } from "./health";
import styles from "./ReaderScreen.module.css";
import { IssueStack, StatusPills } from "./ReaderStatus";
import { useCamera } from "./useCamera";
import { useFullscreen } from "./useFullscreen";
import { useHandTracking } from "./useHandTracking";
import { useBookScan } from "./useBookScan";
import { useLiveScan } from "./useLiveScan";
import { useReaderController } from "./useReaderController";
import { type OverlayHand, VisionOverlay } from "./VisionOverlay";

type ReaderMode = "camera" | "ebook";
const MODE_KEY = "beyondwords.readerMode";

function readMode(): ReaderMode {
  try {
    return sessionStorage.getItem(MODE_KEY) === "ebook" ? "ebook" : "camera";
  } catch {
    return "camera";
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
  const [boxes, setBoxes] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const scan = useReaderStore((s) => s.scan);
  const handLost = useReaderStore((s) => s.handLost);
  const bookTitle = useBooks((b) => b.current?.title ?? null);
  const live = cam.stream !== null;
  const [mode, setMode] = useState<ReaderMode>(readMode);
  const [ebookPageNo, setEbookPageNo] = useState(0);
  const ebook = mode === "ebook";

  const switchMode = (next: ReaderMode) => {
    if (next === mode) return;
    setMode(next);
    try {
      sessionStorage.setItem(MODE_KEY, next);
    } catch {
      // Not remembered; the choice still applies for this visit.
    }
    if (next === "ebook") {
      cam.stop(); // the ebook needs no camera
    } else {
      // Back to the camera: there is no text until it reads some.
      useReaderStore.getState().setPage(EMPTY_PAGE);
    }
  };

  // The ebook needs the (simulated) glasses session for the display; start it for the reader.
  const startSession = r.actions.startSession;
  useEffect(() => {
    if (ebook && r.session === "stopped" && !r.offline) void startSession();
  }, [ebook, r.session, r.offline, startSession]);

  const toggleControls = useCallback(() => setControlsOpen((open) => !open), []);
  const bookScan = useBookScan(videoRef);
  const askAboutPage = r.actions.askAboutPage;
  const tracking = useHandTracking(videoRef, live, toggleControls, () => void askAboutPage());

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
      book: bookTitle,
    }),
    [cam.camera, r.session, r.asleep, r.offline, scan, tracking.stats, handLost, bookTitle],
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
      {ebook ? (
        <EbookView pageNo={ebookPageNo} onPage={setEbookPageNo} onGesture={r.actions.phone} />
      ) : (
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
      )}

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

        {!ebook && (
          <ControlsHint
            open={controlsOpen}
            cameraOn={live}
            progress={tracking.holdProgress}
            onToggle={toggleControls}
          />
        )}
        <PageHint
          cameraOn={live}
          progress={tracking.pageHoldProgress}
          onAsk={() => void askAboutPage()}
        />

        {bookScan.note && (
          <p className={styles.wakeNote} role="status">
            {bookScan.note}
          </p>
        )}
        {r.heyMeta.note && (
          <p className={styles.wakeNote} role="status">
            {r.heyMeta.note}
          </p>
        )}

        <div className={styles.dock} role="toolbar" aria-label="Reading actions">
          <div className={styles.modeSwitch} role="group" aria-label="Reading mode">
            <button
              type="button"
              className={styles.modeButton}
              aria-pressed={!ebook}
              onClick={() => switchMode("camera")}
            >
              Camera
            </button>
            <button
              type="button"
              className={styles.modeButton}
              aria-pressed={ebook}
              onClick={() => switchMode("ebook")}
            >
              Ebook
            </button>
          </div>
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
          {ebook ? null : live ? (
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
          {ebook ? null : (
            <button
              type="button"
              className={styles.button}
              onClick={() => void bookScan.scan()}
              disabled={bookScan.busy || !live}
              title={
                live
                  ? "Hold a book's barcode (or its cover) up to the camera to add it to your library. The photo is read by the reading model and not kept."
                  : "Turn the camera on to scan a book."
              }
            >
              {bookScan.busy ? "Reading book…" : "📚 Scan book"}
            </button>
          )}
          <button
            type="button"
            className={styles.button}
            onClick={r.heyMeta.toggle}
            aria-pressed={r.heyMeta.enabled}
            data-on={r.heyMeta.enabled}
            title="Listen for “Hey Meta” using your browser's speech recognition. Nothing goes to ElevenLabs until you have said it and are asking a question."
          >
            {!r.heyMeta.enabled
              ? "👂 Hey Meta"
              : r.session !== "started"
                ? "👂 Hey Meta: on · start reading"
                : r.heyMeta.state === "retrying"
                  ? "👂 Hey Meta: reconnecting…"
                  : "👂 Hey Meta: on"}
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => void r.actions.askByVoice()}
            disabled={r.voice === "thinking" || r.voice === "starting"}
            aria-pressed={r.voice === "listening"}
            data-listening={r.voice === "listening"}
          >
            {r.voice === "listening"
              ? "⏹ Stop"
              : r.voice === "starting"
                ? "Starting…"
                : r.voice === "thinking"
                  ? "Thinking…"
                  : "🎤 Ask"}
          </button>
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
