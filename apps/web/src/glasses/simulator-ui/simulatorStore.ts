// State of the simulated glasses. Written by WebSimulatorAdapter, read by the simulator panel.
import { createStore } from "zustand/vanilla";

import type { Cue, GlassesState } from "../adapter";
import type { DeviceInput } from "../web-simulator/gestures";
import type { DisplayContent } from "./displayModel";

export interface SimulatorState {
  /** The ONE item on the display (or null). Replacing it is the only way to change it. */
  content: DisplayContent | null;
  /** Simulates Ray-Ban Meta Gen 2: no display, audio cues only. */
  audioOnly: boolean;
  /** Physical state of the glasses (worn, folded, battery, ...). */
  device: GlassesState;
  /** The running camera stream, for the viewfinder. */
  cameraStream: MediaStream | null;
  /** Push-to-talk or wake listening is active. */
  listening: boolean;
  wakeListening: boolean;
  /** Feedback shown in the panel so everything can be checked with the sound off. */
  lastCue: { kind: Cue; at: number } | null;
  lastInput: { input: DeviceInput; at: number } | null;
  lastHeard: { text: string; at: number } | null;
  /** Capture flash (LED blink). */
  flashAt: number | null;
}

export const INITIAL_DEVICE: GlassesState = {
  connected: true,
  worn: true,
  folded: false,
  battery: 80,
  volume: 0.7,
  cameraActive: false,
};

export type SimulatorStore = ReturnType<typeof createSimulatorStore>;

export function createSimulatorStore() {
  return createStore<SimulatorState>(() => ({
    content: null,
    audioOnly: false,
    device: INITIAL_DEVICE,
    cameraStream: null,
    listening: false,
    wakeListening: false,
    lastCue: null,
    lastInput: null,
    lastHeard: null,
    flashAt: null,
  }));
}

/** The display is visible only when the glasses can actually show something. */
export function isDisplayOn(s: Pick<SimulatorState, "audioOnly" | "device">): boolean {
  return !s.audioOnly && s.device.connected && s.device.worn && !s.device.folded;
}
