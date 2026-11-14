// The controls: a glass sheet that slides in over the camera view (so it also works fullscreen)
// and out again. Four tabs: the page text, the hand gestures (a guide), camera view options and
// the glasses simulator. Shown and hidden by the Controls button, the C key, or holding thumb and little finger out
// to the camera (see ControlsHint).
import { useState } from "react";

import { GlassesControlsPanel } from "@/glasses";
import type { Page, ReaderPosition } from "@/reader";

import styles from "./ControlsSheet.module.css";
import { useSettings } from "@/state";

import { useOcrState } from "./ocrEngine";
import { GESTURE_GUIDE } from "./gestureGuide";

type TabId = "reading" | "gestures" | "camera" | "glasses";

const POINTERS = [
  ["auto", "Automatic: finger or mouse, whichever you use"],
  ["finger", "Finger only"],
  ["mouse", "Mouse only"],
] as const;

const TABS: { id: TabId; label: string }[] = [
  { id: "reading", label: "Reading" },
  { id: "gestures", label: "Gestures" },
  { id: "camera", label: "Camera" },
  { id: "glasses", label: "Glasses" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  page: Page;
  position: ReaderPosition;
  /** The glasses session has not been started yet. */
  sessionStopped: boolean;
  offline: boolean;
  showSkeleton: boolean;
  onSkeleton: (on: boolean) => void;
  showBoxes: boolean;
  onBoxes: (on: boolean) => void;
}

export function ControlsSheet({
  open,
  onClose,
  page,
  position,
  sessionStopped,
  offline,
  showSkeleton,
  onSkeleton,
  showBoxes,
  onBoxes,
}: Props) {
  const [tab, setTab] = useState<TabId>("reading");
  const pointer = useSettings((x) => x.pointer);
  const setPointer = useSettings((x) => x.setPointer);
  const ocrChoice = useOcrState((o) => o.choice);
  const setOcrChoice = useOcrState((o) => o.setChoice);
  const cloudAvailable = useOcrState((o) => o.cloudAvailable);
  const ocrUsing = useOcrState((o) => o.using);
  const ocrProblem = useOcrState((o) => o.problem);

  return (
    <aside
      id="reader-controls"
      className={styles.sheet}
      data-open={open}
      aria-label="Controls"
      aria-hidden={!open}
      inert={!open}
    >
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Controls</h2>
          <p className={styles.sub}>
            Hold thumb + pinky out to the camera, or press <kbd>C</kbd>, to hide
          </p>
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="Close controls"
        >
          ×
        </button>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Controls sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            className={styles.tab}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        className={styles.panel}
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
      >
        {tab === "reading" && (
          <>
            {sessionStopped && !offline && (
              <p className={styles.callout}>
                Press <strong>Start reading</strong>: the glasses display needs your go-ahead.
              </p>
            )}
            <div className={styles.text}>
              {page.lines.map((l, li) => (
                <p key={li} className={styles.line}>
                  {l.phrases.map((p, pi) => (
                    <span
                      key={pi}
                      className={
                        li === position.line && pi === position.phrase ? styles.current : undefined
                      }
                    >
                      {p.text}{" "}
                    </span>
                  ))}
                </p>
              ))}
            </div>
          </>
        )}

        {tab === "gestures" && (
          <>
            <ul className={styles.guide}>
              {GESTURE_GUIDE.map((g) => (
                <li key={g.name} className={styles.guideRow}>
                  <span className={styles.guideIcon} aria-hidden="true">
                    {g.icon}
                  </span>
                  <span>
                    <strong>{g.name}</strong>
                    <span className={styles.guideDoes}>{g.does}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className={styles.note}>
              No camera hands? Keys work too: <kbd>Enter</kbd> select, <kbd>Esc</kbd> back, arrows
              move, <kbd>C</kbd> controls.
            </p>
          </>
        )}

        {tab === "camera" && (
          <>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={showSkeleton}
                onChange={(e) => onSkeleton(e.target.checked)}
              />
              Show hand skeleton
            </label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={showBoxes}
                onChange={(e) => onBoxes(e.target.checked)}
              />
              Show text boxes (debug)
            </label>
            <fieldset className={styles.readerChoice}>
              <legend>Pointer</legend>
              {POINTERS.map(([id, label]) => (
                <label key={id} className={styles.toggle}>
                  <input
                    type="radio"
                    name="pointer"
                    checked={pointer === id}
                    onChange={() => setPointer(id)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <fieldset className={styles.readerChoice}>
              <legend>Text reader</legend>
              <label className={styles.toggle}>
                <input
                  type="radio"
                  name="ocr"
                  checked={ocrChoice === "cloud"}
                  onChange={() => setOcrChoice("cloud")}
                  disabled={cloudAvailable === false}
                />
                Google Cloud Vision (more accurate)
              </label>
              <label className={styles.toggle}>
                <input
                  type="radio"
                  name="ocr"
                  checked={ocrChoice === "local"}
                  onChange={() => setOcrChoice("local")}
                />
                On this device (private, works offline)
              </label>
            </fieldset>
            <p className={styles.note} role="status">
              {cloudAvailable === false
                ? "Google Cloud Vision isn't set up on the server, so text is read on this device."
                : ocrProblem
                  ? `${ocrProblem} Reading on this device for now.`
                  : ocrUsing === "cloud"
                    ? "Reading with Google Cloud Vision."
                    : ocrUsing === "local"
                      ? "Reading on this device."
                      : "Starts when the camera is on."}
            </p>
            <p className={styles.note}>
              {ocrChoice === "cloud" && cloudAvailable !== false
                ? "With Google Cloud Vision, camera frames are sent to Google to be read (through our server). They are not saved by us."
                : "Camera frames stay in this browser tab: nothing is saved or uploaded."}
            </p>
          </>
        )}

        {tab === "glasses" && <GlassesControlsPanel />}
      </div>
    </aside>
  );
}
