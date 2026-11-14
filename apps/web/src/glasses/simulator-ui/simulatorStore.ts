// State of the simulated glasses. Written by WebSimulatorAdapter, read by the simulator panel.
// This is device state only: reader state (page, line, phrase) lives in the app store
// (SIM-SES-07, phone is the source of truth).
import { createStore } from "zustand/vanilla";

import type { Cue, GlassesGesture, SessionState, StatusKind } from "../adapter";
import type { DisplayContent } from "./displayModel";
import type { Scene } from "./scene";

export interface SimulatorState {
  session: SessionState;
  /** The ONE item requested for the display (or null). */
  item: DisplayContent | null;
  /** Small status icon requested next to the item. */
  status: StatusKind | null;
  /** What the display shows: the whole scene, replaced on every (throttled) update. */
  scene: Scene;
  /** SIM-DSP-02: number of whole-screen updates and when the last one happened. */
  updateCount: number;
  lastUpdateAt: number | null;
  /** SIM-DSP-04: update rate limit (default 5/s, 1-20). */
  maxUpdatesPerSecond: number;
  /** Recent display warnings (ignored calls, truncated text), newest first. */
  warnings: { message: string; at: number }[];
  /** Simulates Ray-Ban Meta Gen 2: no display, audio cues only. */
  audioOnly: boolean;
  /** Last cue, shown visually too so it can be checked with the sound off. */
  lastCue: { kind: Cue; at: number } | null;
  /** Simulated link to the glasses (SIM-SES-05). */
  connected: boolean;
  reconnecting: boolean;
  /** Display power state (SIM-SES-04): dims after the idle timeout, then blanks. */
  sleep: "awake" | "dimmed" | "asleep";
  sleepTimeoutMs: number;
  /** The session was taken by a simulated call/notification (SIM-SES-03). */
  interrupted: boolean;
  /** SIM-GST-02: gestures received, newest first. */
  gestureLog: GestureLogEntry[];
  /** Camera hand shapes stand in for the Neural Band (keys and pad stay as fallback). */
  cameraGestures: boolean;
  /** Flip left/right camera swipes (camera facing the user). */
  cameraGesturesMirrored: boolean;
}

export interface GestureLogEntry {
  gesture: GlassesGesture;
  /** "pad", the key ("key ArrowRight") or the camera gesture ("camera index pinch"). */
  source: string;
  result: "delivered" | "woke the display" | "ignored: disconnected";
  at: number;
}

export const GESTURE_LOG_SIZE = 20;

/** SIM-DSP-04 default. [ASSUMPTION] our estimate. */
export const DEFAULT_MAX_UPDATES_PER_SECOND = 5;

/** SIM-SES-04 default. [ASSUMPTION] our estimate, not a Meta figure. */
export const DEFAULT_SLEEP_TIMEOUT_MS = 30_000;

export type SimulatorStore = ReturnType<typeof createSimulatorStore>;

export function createSimulatorStore() {
  return createStore<SimulatorState>(() => ({
    session: "stopped",
    item: null,
    status: null,
    scene: null,
    updateCount: 0,
    lastUpdateAt: null,
    maxUpdatesPerSecond: DEFAULT_MAX_UPDATES_PER_SECOND,
    warnings: [],
    audioOnly: false,
    lastCue: null,
    connected: true,
    reconnecting: false,
    sleep: "awake",
    sleepTimeoutMs: DEFAULT_SLEEP_TIMEOUT_MS,
    interrupted: false,
    gestureLog: [],
    cameraGestures: true,
    cameraGesturesMirrored: false,
  }));
}
