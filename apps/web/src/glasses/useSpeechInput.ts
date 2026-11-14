// Ask by voice: record the reader's question and turn it into text (ElevenLabs speech-to-text,
// through our API). The recording is not kept: it is sent for transcription and dropped.
import { useMemo } from "react";

import { useGlasses } from "./context";
import { SpeechHttpError } from "./web-simulator/elevenLabs";
import { WebSimulatorAdapter } from "./web-simulator/WebSimulatorAdapter";

/** Why a question could not be heard. */
export type HearingProblem = "no-speech" | "unavailable" | "no-microphone";

export interface SpeechInput {
  /** Whether there is a microphone path at all (the simulator). */
  available: boolean;
  /**
   * Start recording. Rejects when the microphone cannot be used (blocked, none). `onEndpoint`
   * fires once when the reader has finished speaking ("ended": send it) or never started
   * ("no-speech"): the recording then needs `stop()` or `cancel()`.
   */
  start: (onEndpoint?: (reason: "ended" | "no-speech") => void) => Promise<void>;
  /** Drop the recording without sending it. */
  cancel: () => void;
  /** Stop recording and return what was said. Rejects with a HearingProblem. */
  stop: () => Promise<string>;
}

export class HearingError extends Error {
  readonly problem: HearingProblem;
  constructor(problem: HearingProblem) {
    super(problem);
    this.name = "HearingError";
    this.problem = problem;
  }
}

export function useSpeechInput(): SpeechInput {
  const adapter = useGlasses();
  return useMemo(() => {
    const sim = adapter instanceof WebSimulatorAdapter ? adapter : null;
    return {
      available: sim !== null,
      cancel: () => sim?.cancelRecording(),
      start: async (onEndpoint) => {
        if (!sim) throw new HearingError("unavailable");
        try {
          await sim.startRecording(onEndpoint);
        } catch {
          throw new HearingError("no-microphone");
        }
      },
      stop: async () => {
        if (!sim) throw new HearingError("unavailable");
        const audio = sim.stopRecording();
        if (!audio) throw new HearingError("no-speech"); // too short to be a question
        try {
          return await sim.transcribe(audio);
        } catch (error) {
          // 422 from the API = it heard nothing; anything else = the service is not answering.
          throw new HearingError(
            error instanceof SpeechHttpError && error.status === 422 ? "no-speech" : "unavailable",
          );
        }
      },
    };
  }, [adapter]);
}
