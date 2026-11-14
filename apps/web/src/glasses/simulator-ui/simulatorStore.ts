// State of the simulated glasses: what the display shows, audio-only mode, last cue played.
// Written by WebSimulatorAdapter, read by the DisplaySimulator panel.
import { createStore } from "zustand/vanilla";

import type { Cue } from "../adapter";
import type { DisplayContent } from "./displayModel";

export interface SimulatorState {
  /** The ONE item on the display (or null). Replacing it is the only way to change it. */
  content: DisplayContent | null;
  /** Simulates Ray-Ban Meta Gen 2: no display, audio cues only. */
  audioOnly: boolean;
  /** Last cue, shown visually too so it can be checked with the sound off. */
  lastCue: { kind: Cue; at: number } | null;
}

export type SimulatorStore = ReturnType<typeof createSimulatorStore>;

export function createSimulatorStore() {
  return createStore<SimulatorState>(() => ({
    content: null,
    audioOnly: false,
    lastCue: null,
  }));
}
