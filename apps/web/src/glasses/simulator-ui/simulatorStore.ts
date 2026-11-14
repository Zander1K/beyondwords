// State of the simulated glasses. Written by WebSimulatorAdapter, read by the simulator panel.
// This is device state only: reader state (page, line, phrase) lives in the app store
// (SIM-SES-07, phone is the source of truth).
import { createStore } from "zustand/vanilla";

import type { Cue, SessionState, StatusKind } from "../adapter";
import type { DisplayContent } from "./displayModel";

export interface SimulatorState {
  session: SessionState;
  /** The ONE item on the display (or null). Replacing it is the only way to change it. */
  content: DisplayContent | null;
  /** Small status icon next to the item. */
  status: StatusKind | null;
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
}

/** SIM-SES-04 default. [ASSUMPTION] our estimate, not a Meta figure. */
export const DEFAULT_SLEEP_TIMEOUT_MS = 30_000;

export type SimulatorStore = ReturnType<typeof createSimulatorStore>;

export function createSimulatorStore() {
  return createStore<SimulatorState>(() => ({
    session: "stopped",
    content: null,
    status: null,
    audioOnly: false,
    lastCue: null,
    connected: true,
    reconnecting: false,
    sleep: "awake",
    sleepTimeoutMs: DEFAULT_SLEEP_TIMEOUT_MS,
    interrupted: false,
  }));
}
