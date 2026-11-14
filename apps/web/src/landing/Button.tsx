// The call-to-action button, after ALX Studio's: a pill whose fill sweeps in from wherever the
// pointer crosses its edge (and back out toward where it leaves), with an arrow that nudges right.
// The label colour never changes, so contrast holds throughout.
import type { ButtonHTMLAttributes, PointerEvent } from "react";

import styles from "./Button.module.css";

type Variant = "light" | "blue";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  label: string;
  /** light: white pill with a blue glow (on dark surfaces). blue: brand-blue gradient. */
  variant?: Variant;
  size?: "md" | "lg";
  arrow?: boolean;
}

// Remember where the pointer crossed the edge so the fill grows from, and retracts toward, it.
function trackPointer(e: PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--x", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--y", `${e.clientY - r.top}px`);
}

export function Button({ label, variant = "light", size = "lg", arrow = true, ...rest }: Props) {
  return (
    <button
      type="button"
      className={`${styles.btn} ${styles[variant]} ${styles[size]}`}
      onPointerEnter={trackPointer}
      onPointerLeave={trackPointer}
      {...rest}
    >
      <span aria-hidden="true" className={styles.fill} />
      <span>{label}</span>
      {arrow && (
        <svg
          className={styles.arrow}
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      )}
    </button>
  );
}
