// A small prompt that teaches the gesture for the whole-page gist: "Hold index + pinky out
// (rock sign) for the page gist". While it is held a ring fills around the icon; when it
// completes the gist is asked for. Clicking it does the same. Shrinks to the icon like the
// controls hint (shares its styles).
import styles from "./ControlsHint.module.css";

interface Props {
  /** The camera is on, so the hand gesture can work. */
  cameraOn: boolean;
  /** 0-1: how far through holding the gesture. */
  progress: number;
  onAsk: () => void;
}

export function PageHint({ cameraOn, progress, onAsk }: Props) {
  const text = cameraOn ? "Hold index + pinky out for the page gist" : "Page gist";
  return (
    <button
      type="button"
      className={styles.hint}
      data-compact={progress === 0}
      data-holding={progress > 0}
      style={{ ["--p" as string]: `${Math.round(progress * 360)}deg` }}
      onClick={onAsk}
      aria-label={`${text}. Asks for the gist of the whole page.`}
    >
      <span className={styles.icon} aria-hidden="true">
        🤘
      </span>
      <span className={styles.text}>{text}</span>
    </button>
  );
}
