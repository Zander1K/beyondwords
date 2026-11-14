// Finger guidance from the camera (SIM-VIS-01, 03, 04). Runs hand tracking on the live view,
// publishes every frame to the hands feed (the simulated band reads gestures from it), moves the
// reader to the line and phrase under the pointing fingertip, and handles a lost hand.
import { type RefObject, useEffect, useRef, useState } from "react";

import { useGlasses } from "@/glasses";
import { useReaderStore } from "@/state";
import {
  classifyPose,
  FingerDetector,
  type FingerTip,
  handsFeed,
  HoldDetector,
  initialPickerState,
  LM,
  MediaPipeHandTracker,
  pickLine,
  type PickerState,
  type Point,
  PointFilter,
} from "@/vision";

import type { OverlayHand } from "./VisionOverlay";

/** Detection rate cap. [ASSUMPTION] 20/s keeps the main thread responsive (knob is P1). */
const MAX_DETECT_FPS = 20;
/** SIM-VIS-04: no pointing hand for this long = hand lost (tunable, default 700 ms). */
export const HAND_LOST_MS = 700;
/**
 * A hand whose index tip is within this distance (fraction of the image) of last frame's
 * pointer tip is the same pointing hand: it keeps the looser "still pointing" test.
 */
const SAME_POINTER_DISTANCE = 0.12;

/** The hand (index into `tips`) nearest `last`, if it is close enough to be the same pointer. */
export function samePointer(tips: readonly (Point | undefined)[], last: Point | null): number {
  if (!last) return -1;
  let best = -1;
  let bestDistance = SAME_POINTER_DISTANCE;
  tips.forEach((t, i) => {
    if (!t) return;
    const d = Math.hypot(t.x - last.x, t.y - last.y);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}

export type TrackingStatus = "off" | "loading" | "running" | "error";

export interface TrackingStats {
  status: TrackingStatus;
  fps: number;
  detectMs: number;
  /** The cursor is a lone finger (no whole hand in view), found by the finger-only detector. */
  fingerOnly: boolean;
}

// One tracker for the app; the model loads on first use.
const tracker = new MediaPipeHandTracker();
// MediaPipe needs the palm in view; this finds a lone finger when it sees no hand, with skin
// colour learned from the hands MediaPipe does see.
const fingers = new FingerDetector();

/**
 * @param onControlsGesture called once each time the controls gesture (thumb and little finger
 * out) has been held long enough (the gesture that
 * shows or hides the controls). Not a glasses gesture: it belongs to the simulator's own UI.
 */
export function useHandTracking(
  videoRef: RefObject<HTMLVideoElement | null>,
  active: boolean,
  onControlsGesture?: () => void,
) {
  const glasses = useGlasses();
  const [attempt, setAttempt] = useState(0);
  const [holdProgress, setHoldProgress] = useState(0);
  const controlsHandler = useRef(onControlsGesture);
  useEffect(() => {
    controlsHandler.current = onControlsGesture;
  });
  const [stats, setStats] = useState<TrackingStats>({
    status: "off",
    fps: 0,
    detectMs: 0,
    fingerOnly: false,
  });
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
    // The pointer hand's raw tip last frame (to follow the same hand) and its smoothed cursor.
    let lastTip: Point | null = null;
    let lastSource: "hand" | "finger" | null = null;
    const cursor = new PointFilter();
    const hold = new HoldDetector();
    let shownProgress = 0;
    const store = useReaderStore.getState;

    const loop = (now: number) => {
      if (stopped) return;
      raf = requestAnimationFrame(loop);
      const video = videoRef.current;
      if (!video || video.readyState < 2 || now - lastDetect < 1000 / MAX_DETECT_FPS) return;
      lastDetect = now;

      const frame = tracker.detect(video, now);
      handsFeed.publish(frame);

      // The pointing hand is the reading cursor; other hands are free for gestures. The hand that
      // pointed last frame keeps a looser test, so the cursor does not drop when its other
      // fingers drift open for a moment.
      const tips = frame.hands.map((h) => h.landmarks[LM.indexTip]);
      const previous = samePointer(tips, lastTip);
      const poses = frame.hands.map((h, i) =>
        classifyPose(h.landmarks, null, h.world, i === previous),
      );
      const pointerIndex =
        previous >= 0 && poses[previous] === "pointing" ? previous : poses.indexOf("pointing");

      // Thumb and little finger out, held for a moment, shows or hides the controls. Progress is
      // shown in steps, so the ring does not re-render the screen on every frame.
      const held = hold.update(poses.includes("shaka"), now);
      if (held.fired) controlsHandler.current?.();
      const stepped = Math.round(held.progress * 20) / 20;
      if (stepped !== shownProgress) {
        shownProgress = stepped;
        setHoldProgress(stepped);
      }
      const handTip = tips[pointerIndex];

      // No hand at all: maybe just a finger in the frame (MediaPipe needs the palm). While it
      // does see hands, it teaches the finger detector the user's skin colour.
      let finger: FingerTip | null = null;
      if (frame.hands.length) {
        fingers.clear();
        fingers.learn(
          video,
          frame.hands.map((h) => h.landmarks),
          now,
        );
      } else {
        finger = fingers.detect(video);
      }
      const rawTip = handTip ?? finger?.tip;
      const source = handTip ? "hand" : finger ? "finger" : null;

      // A different hand, a switch between hand and finger, or a gap: no smoothing across it.
      if (rawTip && (source !== lastSource || (source === "hand" && pointerIndex !== previous))) {
        cursor.reset();
      }
      if (source) lastSource = source;
      // Remember the pointer through brief dropouts, forget it once the hand is lost.
      if (rawTip) lastTip = rawTip;
      else if (now - lastPointerAt > HAND_LOST_MS) lastTip = null;
      const tip = rawTip ? cursor.filter(rawTip, now) : undefined;
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

      const shown: OverlayHand[] = frame.hands.map((h, i) => ({
        landmarks: h.landmarks,
        role: i === pointerIndex ? "pointer" : poses[i] === "other" ? "other" : "gesture",
        cursor: i === pointerIndex ? tip : undefined,
      }));
      // A lone finger: from where it enters the frame to its tip (also tells the page merge
      // which lines it hides).
      if (finger && tip) {
        shown.push({
          landmarks: [finger.base, finger.tip],
          role: "pointer",
          cursor: tip,
          finger: true,
        });
      }
      setHands(shown);
      frames += 1;
      if (now - fpsSince >= 1000) {
        fps = Math.round((frames * 1000) / (now - fpsSince));
        frames = 0;
        fpsSince = now;
      }
      setStats({
        status: "running",
        fps,
        detectMs: Math.round(frame.detectMs),
        fingerOnly: source === "finger",
      });
    };

    tracker
      .init()
      .then(() => {
        if (!stopped) raf = requestAnimationFrame(loop);
      })
      .catch((error: unknown) => {
        console.warn("[vision] hand tracking failed to start", error);
        if (!stopped) setStats({ status: "error", fps: 0, detectMs: 0, fingerOnly: false });
      });

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      setHands([]);
      setHoldProgress(0);
      setStats({ status: "off", fps: 0, detectMs: 0, fingerOnly: false });
      useReaderStore.getState().setHandLost(false);
    };
  }, [active, videoRef, glasses, attempt]);

  // A new page (page turned) invalidates the picker's line. Continuous reads of the same page
  // keep the id, so the picker's hysteresis survives them.
  const pageId = useReaderStore((s) => s.page.id);
  useEffect(() => {
    picker.current = initialPickerState;
  }, [pageId]);

  // Until the first frame arrives, an active tracker is still loading its model.
  const shown: TrackingStats =
    active && stats.status === "off" ? { ...stats, status: "loading" } : stats;
  return {
    stats: shown,
    hands,
    connections: tracker.connections,
    /** 0-1: how far through holding the controls gesture. */
    holdProgress,
    /** Try loading the hand model again after it failed. */
    retry: () => setAttempt((a) => a + 1),
  };
}
