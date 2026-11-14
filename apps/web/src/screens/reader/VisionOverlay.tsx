// Debug overlays on the camera view (not part of the glasses display): OCR line boxes, the
// current line outlined, the current phrase highlighted, and (when hands are tracked) the
// fingertip and hand skeleton. Coordinates are normalised to the camera image.
import { useEffect, useRef } from "react";

import { type Page, phraseSpan, type ReaderPosition } from "@/reader";

export interface OverlayHand {
  /** 21 normalised landmarks (MediaPipe hand model). */
  landmarks: readonly { x: number; y: number }[];
  role: "pointer" | "gesture" | "other";
}

interface Props {
  page: Page;
  position: ReaderPosition;
  hands?: OverlayHand[];
  showSkeleton?: boolean;
  /** Pairs of landmark indices to connect for the skeleton. */
  connections?: ReadonlyArray<{ start: number; end: number }>;
}

export function VisionOverlay({ page, position, hands = [], showSkeleton, connections }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // OCR line boxes; the current line outlined, the current phrase filled.
      page.lines.forEach((line, i) => {
        const box = line.box;
        if (!box) return;
        const current = i === position.line;
        ctx.lineWidth = current ? 3 : 1;
        ctx.strokeStyle = current ? "#ffd84d" : "rgba(80, 200, 255, 0.8)";
        ctx.strokeRect(box.x * w, box.y * h, box.w * w, box.h * h);
        if (current) {
          const span = phraseSpan(page, position);
          if (span) {
            ctx.fillStyle = "rgba(255, 216, 77, 0.35)";
            const x0 = (box.x + box.w * span[0]) * w;
            const x1 = (box.x + box.w * span[1]) * w;
            ctx.fillRect(x0, box.y * h, x1 - x0, box.h * h);
          }
        }
      });

      for (const hand of hands) {
        const color =
          hand.role === "pointer" ? "#ff4d6d" : hand.role === "gesture" ? "#7cf29c" : "#ccc";
        if (showSkeleton && connections) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          for (const { start, end } of connections) {
            const a = hand.landmarks[start];
            const b = hand.landmarks[end];
            if (!a || !b) continue;
            ctx.beginPath();
            ctx.moveTo(a.x * w, a.y * h);
            ctx.lineTo(b.x * w, b.y * h);
            ctx.stroke();
          }
        }
        // Index fingertip (landmark 8): the reading cursor on the pointing hand.
        const tip = hand.landmarks[8];
        if (tip) {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(tip.x * w, tip.y * h, hand.role === "pointer" ? 9 : 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#fff";
          ctx.stroke();
        }
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [page, position, hands, showSkeleton, connections]);

  return <canvas ref={ref} style={{ width: "100%", height: "100%", display: "block" }} />;
}
