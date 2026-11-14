// A small prompt that teaches the gesture for the controls: "Hold thumb + pinky out to show
// controls" (a shaka). While it is held a ring fills around the icon; when it completes the
// controls toggle.
// The chip is full width for a few seconds, then shrinks to just the icon (it widens again on
// hover, focus, a hold, or when the controls open or close). Clicking it also toggles.
import { useEffect, useState } from "react";

import styles from "./ControlsHint.module.css";

/** How long the full prompt stays before it shrinks to the icon. */
const EXPANDED_MS = 8000;

interface Props {
  /** The controls are showing. */
  open: boolean;
  /** The camera is on, so the hand gesture can work; otherwise the prompt names the key. */
  cameraOn: boolean;
  /** 0-1: how far through holding the gesture. */
  progress: number;
  onToggle: () => void;
}

export function ControlsHint({ open, cameraOn, progress, onToggle }: Props) {
  // The prompt shrinks a few seconds after the controls last changed state. Keyed by that
  // state, so it is full again whenever the state changes (no reset needed).
  const key = `${open}|${cameraOn}`;
  const [shrunkFor, setShrunkFor] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setShrunkFor(key), EXPANDED_MS);
    return () => clearTimeout(timer);
  }, [key]);
  const compact = shrunkFor === key;

  const verb = open ? "hide" : "show";
  const text = cameraOn
    ? `Hold thumb + pinky out to ${verb} controls`
    : `Press C to ${verb} controls`;

  return (
    <button
      type="button"
      className={styles.hint}
      data-compact={compact && progress === 0}
      data-holding={progress > 0}
      style={{ ["--p" as string]: `${Math.round(progress * 360)}deg` }}
      onClick={onToggle}
      aria-label={`${text}. Or press the C key.`}
    >
      <span className={styles.icon} aria-hidden="true">
        {cameraOn ? "🤙" : "C"}
      </span>
      <span className={styles.text}>{text}</span>
    </button>
  );
}
