// "Hey Meta": while `active`, listen for the wake phrase (the browser's own speech recognition;
// ElevenLabs hears nothing until the phrase has fired and a question is being recorded).
// `onWake` fires once per hearing; the listener then stops, so the microphone is free for the
// question. Make `active` true again to listen again.
import { useEffect, useRef, useState } from "react";

import { useGlasses } from "./context";
import type { WakeProblem, WakeState } from "./web-simulator/wakeWord";
import { WebSimulatorAdapter } from "./web-simulator/WebSimulatorAdapter";

export type { WakeProblem, WakeState };

export interface WakeWord {
  /** Whether this browser can listen for the phrase at all. */
  supported: boolean;
  /** "listening", or "retrying" while the browser's speech service is failing for a moment. */
  state: WakeState | null;
}

export function useWakeWord(
  active: boolean,
  onWake: () => void,
  onProblem: (problem: WakeProblem, detail: string) => void,
): WakeWord {
  const adapter = useGlasses();
  const sim = adapter instanceof WebSimulatorAdapter ? adapter : null;
  const handlers = useRef({ onWake, onProblem });
  useEffect(() => {
    handlers.current = { onWake, onProblem };
  });
  // Whether the browser can do it is a fact about the browser: read it once.
  const [supported] = useState(() => sim?.wakeWordSupported() ?? false);
  const [state, setState] = useState<WakeState | null>(null);

  useEffect(() => {
    if (!sim || !active) return;
    sim.startWakeWord(
      () => handlers.current.onWake(),
      (problem, detail) => handlers.current.onProblem(problem, detail),
      setState,
    );
    return () => {
      sim.stopWakeWord();
      setState(null);
    };
  }, [sim, active]);

  return { supported, state };
}
