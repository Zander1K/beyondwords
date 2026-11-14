// The reading highlight and hand overlay on the camera view (not part of the glasses display):
// the current line, phrase and pointed word, and the fingertip. Drawn on a canvas by
// overlayDraw.ts, which also eases the highlight between positions. Coordinates are normalised
// to the camera image.
import { useEffect, useRef } from "react";

import type { Page, ReaderPosition } from "@/reader";

import { createOverlay, type OverlayProps } from "./overlayDraw";

export interface OverlayHand {
  /** 21 normalised landmarks (MediaPipe hand model). */
  landmarks: readonly { x: number; y: number }[];
  role: "pointer" | "gesture" | "other";
  /** The smoothed fingertip the reader follows (pointer hand only). */
  cursor?: { x: number; y: number };
  /**
   * A lone finger (no whole hand in view): `landmarks` is then just [where it enters the frame,
   * its tip].
   */
  finger?: boolean;
}

interface Props {
  page: Page;
  position: ReaderPosition;
  hands?: OverlayHand[];
  showSkeleton?: boolean;
  /** Debug: draw the OCR line and word boxes. */
  showBoxes?: boolean;
  /** Pairs of landmark indices to connect for the skeleton. */
  connections?: ReadonlyArray<{ start: number; end: number }>;
}

export function VisionOverlay({
  page,
  position,
  hands = [],
  showSkeleton = false,
  showBoxes = false,
  connections,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const props = useRef<OverlayProps>({
    page,
    position,
    hands,
    showSkeleton,
    showBoxes,
    connections,
  });
  const overlay = useRef<ReturnType<typeof createOverlay> | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    overlay.current = createOverlay(canvas, props);
    return () => {
      overlay.current?.dispose();
      overlay.current = null;
    };
  }, []);

  useEffect(() => {
    props.current = { page, position, hands, showSkeleton, showBoxes, connections };
    overlay.current?.update();
  }, [page, position, hands, showSkeleton, showBoxes, connections]);

  return <canvas ref={ref} style={{ width: "100%", height: "100%", display: "block" }} />;
}
