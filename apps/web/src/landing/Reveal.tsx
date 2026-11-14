// Fades and lifts its children in the first time they scroll into view (ALX Studio's Reveal).
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";

import styles from "./Reveal.module.css";

interface Props {
  children: ReactNode;
  className?: string;
  /** ms */
  delay?: number;
}

export function Reveal({ children, className = "", delay = 0 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Without IntersectionObserver there is nothing to wait for: show it from the start.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-visible={visible}
      className={`${styles.reveal} ${className}`}
      style={{ ["--delay" as string]: `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}
