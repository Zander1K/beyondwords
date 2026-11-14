// Fullscreen for the reader view. Uses the browser Fullscreen API where an element can go
// fullscreen; iPhone Safari only allows that for <video>, so there the view instead fills the
// viewport with CSS ("css" mode).
import { type RefObject, useCallback, useEffect, useState } from "react";

export type FullscreenMode = "off" | "native" | "css";

interface WebkitElement extends HTMLElement {
  webkitRequestFullscreen?: () => void;
}
interface WebkitDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
}

function fullscreenElement(): Element | null {
  const doc = document as WebkitDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [mode, setMode] = useState<FullscreenMode>("off");

  // Leaving native fullscreen with the browser's own controls (Esc, swipe) ends our mode too.
  useEffect(() => {
    const onChange = () => {
      if (!fullscreenElement()) setMode((m) => (m === "native" ? "off" : m));
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const enter = useCallback(async () => {
    const el = ref.current as WebkitElement | null;
    if (!el) return;
    try {
      if (el.requestFullscreen) {
        await el.requestFullscreen();
        setMode("native");
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
        setMode("native");
      } else {
        setMode("css");
      }
    } catch {
      setMode("css");
    }
  }, [ref]);

  const exit = useCallback(() => {
    const doc = document as WebkitDocument;
    if (fullscreenElement()) {
      if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => {});
      else doc.webkitExitFullscreen?.();
    }
    setMode("off");
  }, []);

  const toggle = useCallback(() => {
    if (mode === "off") void enter();
    else exit();
  }, [mode, enter, exit]);

  return { mode, toggle, exit };
}
