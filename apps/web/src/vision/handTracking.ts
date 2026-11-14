// Hand tracking on the live camera (SIM-VIS-01): MediaPipe HandLandmarker in VIDEO mode, up to
// two hands (one pointing at the page, the other free for gestures).
// HACK: runs on the main thread at a capped frame rate; MediaPipe's GPU delegate does the heavy
// work. Move to a worker if the UI stutters (spec: "off the main thread where possible").
// HACK: the WASM runtime and the hand model (~7.8 MB) load from jsDelivr and Google's model
// bucket on first use. Vendor them into public/ for an offline demo.
import type { HandLandmarker } from "@mediapipe/tasks-vision";

import type { Hand, Hand3 } from "./handPose";

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export interface TrackedHand {
  /** 21 landmarks, normalised to the camera image. */
  landmarks: Hand;
  /** The same 21 landmarks in 3D (metres, hand-centred): pose tests use these when present. */
  world?: Hand3;
  /** The subject's hand, as MediaPipe reports it. */
  handedness: "Left" | "Right" | null;
  score: number;
}

export interface HandsFrame {
  hands: TrackedHand[];
  /** performance.now() of the frame. */
  at: number;
  /** Time spent detecting, ms. */
  detectMs: number;
}

export interface HandTracker {
  init(): Promise<void>;
  detect(video: HTMLVideoElement, timestampMs: number): HandsFrame;
  /** Landmark pairs for drawing the hand skeleton. */
  readonly connections: ReadonlyArray<{ start: number; end: number }>;
  dispose(): void;
}

export class MediaPipeHandTracker implements HandTracker {
  private landmarker: HandLandmarker | null = null;
  connections: ReadonlyArray<{ start: number; end: number }> = [];

  async init(): Promise<void> {
    if (this.landmarker) return;
    const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO" as const,
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      // [ASSUMPTION] Slightly below the 0.5 defaults so a hand resting on a busy, printed page
      // keeps being tracked instead of being dropped and re-detected (the cursor blinks out).
      minHandPresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    });
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options("GPU"));
    } catch {
      // No WebGL / GPU delegate: fall back to the CPU.
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options("CPU"));
    }
    this.connections = HandLandmarker.HAND_CONNECTIONS;
  }

  detect(video: HTMLVideoElement, timestampMs: number): HandsFrame {
    const started = performance.now();
    const landmarker = this.landmarker;
    if (!landmarker) return { hands: [], at: timestampMs, detectMs: 0 };
    const result = landmarker.detectForVideo(video, timestampMs);
    const hands: TrackedHand[] = result.landmarks.map((landmarks, i) => {
      const category = result.handedness[i]?.[0];
      const name = category?.categoryName;
      const world = result.worldLandmarks[i];
      return {
        landmarks: landmarks.map(({ x, y }) => ({ x, y })),
        world: world?.map(({ x, y, z }) => ({ x, y, z })),
        handedness: name === "Left" || name === "Right" ? name : null,
        score: category?.score ?? 0,
      };
    });
    return { hands, at: timestampMs, detectMs: performance.now() - started };
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}

/** A tiny feed of hand frames: the reader's cursor and the simulated band both listen. */
export type HandsListener = (frame: HandsFrame) => void;

export interface HandsFeed {
  subscribe(listener: HandsListener): () => void;
}

export function createHandsFeed(): HandsFeed & { publish(frame: HandsFrame): void } {
  const listeners = new Set<HandsListener>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(frame) {
      for (const listener of [...listeners]) listener(frame);
    },
  };
}

/** The app's one feed of hand frames from the camera. */
export const handsFeed = createHandsFeed();
