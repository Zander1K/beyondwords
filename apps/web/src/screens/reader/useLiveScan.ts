// Continuous page reading (SIM-VIS-02, SIM-VIS-05): while the camera runs, frames from the live
// view are read by OCR one after another and merged into the page. The user never presses Scan:
// the text, word boxes and the word under the fingertip stay current as the book moves or the
// page turns.
//
// Frames come from the <video> showing GlassesAdapter.startCamera()'s stream (never the browser
// camera directly). One read is in flight at a time; reads start back to back, at most one per
// MIN_SCAN_INTERVAL_MS, so a slow phone simply scans less often.
import { type RefObject, useEffect } from "react";

import { analyzePage } from "@/api";
import type { Box } from "@/reader";
import { useReaderStore } from "@/state";

import { ocr } from "./ocrEngine";
import type { OverlayHand } from "./VisionOverlay";

/** Fastest scan rate. [ASSUMPTION] ~1/s keeps up with page moves without hogging the CPU. */
const MIN_SCAN_INTERVAL_MS = 800;
/** The slow flattening pass (tilted / curled pages) runs at most this often. */
const UNWARP_EVERY_MS = 10_000;
/** Margin around a hand when deciding which lines it hides (fraction of the frame). */
const HAND_MARGIN = 0.04;

/** Where the hands are in the frame (union of their landmarks plus a margin), or null. */
export function handsBox(hands: readonly OverlayHand[]): Box | null {
  const points = hands.flatMap((h) => h.landmarks);
  if (!points.length) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.max(0, Math.min(...xs) - HAND_MARGIN);
  const y = Math.max(0, Math.min(...ys) - HAND_MARGIN);
  return {
    x,
    y,
    w: Math.min(1, Math.max(...xs) + HAND_MARGIN) - x,
    h: Math.min(1, Math.max(...ys) + HAND_MARGIN) - y,
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useLiveScan(
  videoRef: RefObject<HTMLVideoElement | null>,
  active: boolean,
  handsRef: RefObject<readonly OverlayHand[]>,
): void {
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const store = useReaderStore.getState;

    void (async () => {
      let scans = 0;
      let lastUnwarpAt = Number.NEGATIVE_INFINITY;
      store().setScan({ status: "scanning" });
      while (!stopped) {
        const video = videoRef.current;
        if (!video || video.readyState < 2 || !video.videoWidth) {
          await wait(200);
          continue;
        }
        const started = performance.now();
        try {
          const frame = await createImageBitmap(video);
          const allowUnwarp = started - lastUnwarpAt > UNWARP_EVERY_MS;
          const result = await ocr.recognizeFrame(frame, allowUnwarp);
          if (stopped) break;
          if (result.unwarpTried) lastUnwarpAt = performance.now();
          scans += 1;
          if (result.lines.length === 0) {
            store().setScan({ status: "empty", ocrMs: result.ms });
          } else {
            const page = await analyzePage(result.lines);
            if (stopped) break;
            // Lines under the hand in this frame keep their last reading.
            store().mergeScan(page, handsBox(handsRef.current ?? []));
            store().setScan({
              status: "live",
              lines: store().page.lines.length,
              ocrMs: result.ms,
              scans,
              unwarped: result.unwarped,
            });
          }
        } catch (error) {
          if (stopped) break;
          console.warn("[vision] live scan failed", error);
          store().setScan({
            status: "error",
            message:
              "Reading the page failed. Check the connection (the OCR model downloads once).",
          });
          await wait(2000);
        }
        await wait(Math.max(0, MIN_SCAN_INTERVAL_MS - (performance.now() - started)));
      }
    })();

    return () => {
      stopped = true;
    };
  }, [active, videoRef, handsRef]);
}
