// Finger guidance from the camera (SIM-VIS-01, 03, 04). Runs hand tracking on the live view,
// publishes every frame to the hands feed (the simulated band reads gestures from it), moves the
// reader to the line and phrase under the pointing fingertip, and handles a lost hand.
import { type RefObject, useEffect, useRef, useState } from "react";

import { useGlasses } from "@/glasses";
import { useReaderStore } from "@/state";
import {
  classifyPose,
  handsFeed,
  initialPickerState,
  LM,
  MediaPipeHandTracker,
  pickLine,
  type PickerState,
} from "@/vision";

import type { OverlayHand } from "./VisionOverlay";

/** Detection rate cap. [ASSUMPTION] 20/s keeps the main thread responsive (knob is P1). */
const MAX_DETECT_FPS = 20;
/** SIM-VIS-04: no pointing hand for this long = hand lost (tunable, default 700 ms). */
export const HAND_LOST_MS = 700;

export type TrackingStatus = "off" | "loading" | "running" | "error";

export interface TrackingStats {
  status: TrackingStatus;
  fps: number;
  detectMs: number;
}

// One tracker for the app; the model loads on first use.
const tracker = new MediaPipeHandTracker();

export function useHandTracking(videoRef: RefObject<HTMLVideoElement | null>, active: boolean) {
  const glasses = useGlasses();
  const [stats, setStats] = useState<TrackingStats>({ status: "off", fps: 0, detectMs: 0 });
  const [hands, setHands] = useState<OverlayHand[]>([]);
  const picker = useRef<PickerState>(initialPickerState);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let raf = 0;
    let lastDetect = 0;
    let lastPointerAt = Number.NEGATIVE_INFINITY;
    let frames = 0;
    let fpsSince = performance.now();
    let fps = 0;
    const store = useReaderStore.getState;

    const loop = (now: number) => {
      if (stopped) return;
      raf = requestAnimationFrame(loop);
      const video = videoRef.current;
      if (!video || video.readyState < 2 || now - lastDetect < 1000 / MAX_DETECT_FPS) return;
      lastDetect = now;

      const frame = tracker.detect(video, now);
      handsFeed.publish(frame);

      // The pointing hand is the reading cursor; other hands are free for gestures.
      const poses = frame.hands.map((h) => classifyPose(h.landmarks));
      const pointerIndex = poses.indexOf("pointing");
      const pointer = frame.hands[pointerIndex];
      const tip = pointer?.landmarks[LM.indexTip];
      const s = store();

      if (tip) {
        lastPointerAt = now;
        s.setHandLost(false);
        const page = s.page;
        if (page.lines.some((l) => l.baseline)) {
          picker.current = pickLine(page, tip, picker.current);
          if (picker.current.position) s.setPosition(picker.current.position);
        }
      } else if (now - lastPointerAt > HAND_LOST_MS && Number.isFinite(lastPointerAt)) {
        // Hold the last line; manual gestures keep working.
        if (!s.handLost) {
          s.setHandLost(true);
          if (s.session === "started") glasses.playCue("lost-hand");
        }
      }

      setHands(
        frame.hands.map((h, i) => ({
          landmarks: h.landmarks,
          role: i === pointerIndex ? "pointer" : poses[i] === "other" ? "other" : "gesture",
        })),
      );
      frames += 1;
      if (now - fpsSince >= 1000) {
        fps = Math.round((frames * 1000) / (now - fpsSince));
        frames = 0;
        fpsSince = now;
      }
      setStats({ status: "running", fps, detectMs: Math.round(frame.detectMs) });
    };

    tracker
      .init()
      .then(() => {
        if (!stopped) raf = requestAnimationFrame(loop);
      })
      .catch((error: unknown) => {
        console.warn("[vision] hand tracking failed to start", error);
        if (!stopped) setStats({ status: "error", fps: 0, detectMs: 0 });
      });

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      setHands([]);
      setStats({ status: "off", fps: 0, detectMs: 0 });
      useReaderStore.getState().setHandLost(false);
    };
  }, [active, videoRef, glasses]);

  // A new page (page turned) invalidates the picker's line. Continuous reads of the same page
  // keep the id, so the picker's hysteresis survives them.
  const pageId = useReaderStore((s) => s.page.id);
  useEffect(() => {
    picker.current = initialPickerState;
  }, [pageId]);

  // Until the first frame arrives, an active tracker is still loading its model.
  const shown: TrackingStats =
    active && stats.status === "off" ? { ...stats, status: "loading" } : stats;
  return { stats: shown, hands, connections: tracker.connections };
}
