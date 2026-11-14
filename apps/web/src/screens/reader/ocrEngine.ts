// The text reader for the whole app: Google Cloud Vision when it is set up and switched on, with the
// on-device PaddleOCR as the fallback (and the choice for anyone who wants nothing to leave this
// browser). If Google fails for any reason, that frame is read on-device and Google is left alone
// for a minute, so reading never stops. The on-device models only load if they are needed.
import { create } from "zustand";

import {
  CloudOcr,
  CloudOcrError,
  cloudOcrAvailable,
  type OcrEngine,
  type OcrResult,
  PaddleOcr,
} from "@/vision";

export type OcrChoice = "cloud" | "local";

const KEY = "beyondwords.ocr";
/** After Google fails, read on-device for this long before trying it again. */
const RETRY_MS = 60_000;

function readChoice(): OcrChoice {
  try {
    return localStorage.getItem(KEY) === "local" ? "local" : "cloud";
  } catch {
    return "cloud";
  }
}

interface OcrState {
  /** What the reader wants: Google (when available) or on-device. */
  choice: OcrChoice;
  /** Google Vision is set up on the server (null until asked). */
  cloudAvailable: boolean | null;
  /** Which reader read the last frame. */
  using: OcrChoice | null;
  /** Why Google was not used, when it was wanted. */
  problem: string | null;
  setChoice: (choice: OcrChoice) => void;
}

export const useOcrState = create<OcrState>((set) => ({
  choice: readChoice(),
  cloudAvailable: null,
  using: null,
  problem: null,
  setChoice: (choice) => {
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      // Not remembered; the choice still applies for this visit.
    }
    set({ choice, problem: null });
  },
}));

const PROBLEMS: Record<number, string> = {
  503: "Google Vision isn't answering (check the key, that the Vision API and billing are on).",
  413: "A frame was too large for Google Vision.",
};

class SwitchableOcr implements OcrEngine {
  private readonly cloud = new CloudOcr();
  private readonly local = new PaddleOcr();
  private downUntil = 0;
  private asked = false;

  async recognizeFrame(frame: ImageBitmap): Promise<OcrResult> {
    const state = useOcrState.getState();
    if (!this.asked) {
      this.asked = true;
      void cloudOcrAvailable().then((cloudAvailable) => useOcrState.setState({ cloudAvailable }));
    }
    const wantCloud =
      state.choice === "cloud" && state.cloudAvailable !== false && Date.now() >= this.downUntil;
    if (wantCloud) {
      try {
        const result = await this.cloud.recognizeFrame(frame);
        frame.close();
        if (state.using !== "cloud" || state.problem)
          useOcrState.setState({ using: "cloud", problem: null });
        return result;
      } catch (error) {
        this.downUntil = Date.now() + RETRY_MS;
        const status = error instanceof CloudOcrError ? error.status : 0;
        useOcrState.setState({
          problem: PROBLEMS[status] ?? "Couldn't reach Google Vision.",
          using: "local",
        });
        // fall through: this frame is read on-device
      }
    } else if (state.using !== "local") {
      useOcrState.setState({ using: "local" });
    }
    return this.local.recognizeFrame(frame);
  }

  dispose(): void {
    this.cloud.dispose();
    this.local.dispose();
  }
}

export const ocr: OcrEngine = new SwitchableOcr();
