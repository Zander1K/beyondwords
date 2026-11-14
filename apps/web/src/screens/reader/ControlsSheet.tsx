// The controls: a glass sheet that slides in over the camera view (so it also works fullscreen)
// and out again. Four tabs: the page text, the hand gestures (a guide), camera view options and
// the glasses simulator. Shown and hidden by the Controls button, the C key, or holding thumb and little finger out
// to the camera (see ControlsHint).
import { useState } from "react";

import { GlassesControlsPanel } from "@/glasses";
import type { Page, ReaderPosition } from "@/reader";

import styles from "./ControlsSheet.module.css";
import { GESTURE_GUIDE } from "./gestureGuide";

type TabId = "reading" | "gestures" | "camera" | "glasses";

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
            <p className={styles.note}>
              Camera frames stay in this browser tab: nothing is saved or uploaded.
            </p>
          </>
        )}

        {tab === "glasses" && <GlassesControlsPanel />}
      </div>
    </aside>
  );
}
