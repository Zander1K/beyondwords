// Knowing when someone has finished asking: an "endpoint detector" for a recording in progress.
// It watches the loudness of the microphone and says:
//   "ended"     they spoke, then went quiet long enough: send the question;
//   "no-speech" nothing that sounded like speech arrived in time: give up (do not send silence).
// Loudness only (no speech recognition), so it costs nothing and nothing leaves the device.
// [ASSUMPTION] The numbers are first values for a quiet room and a close microphone; they adapt
// to the room's background level (the quiet at the start). Tune on real recordings.
// Pure: no browser APIs.

export const ENDPOINT_DEFAULTS = {
  /** How long it must be quiet after speech before the question counts as finished. */
  endSilenceMs: 1200,
  /** Give up if no speech has started by this long after recording began. */
  noSpeechMs: 6000,
  /** Never record longer than this. */
  maxMs: 20_000,
  /** Speech this long (in total) counts as a real start, not a click or a cough. */
  minSpeechMs: 200,
  /** Frame length the loudness is measured over. */
  frameMs: 20,
  /** The quietest level ever counted as speech (0-1 of full scale). */
  minThreshold: 0.015,
  /** Speech must be this many times louder than the room's background. */
  floorMultiple: 3,
  /** The first stretch is used to measure the background, if it stays quiet. */
  calibrateMs: 300,
} as const;

export type EndpointOptions = { -readonly [K in keyof typeof ENDPOINT_DEFAULTS]?: number };
export type EndpointStatus = "waiting" | "speaking" | "ended" | "no-speech";

export class EndpointDetector {
  private readonly o: Required<EndpointOptions>;
  private readonly frameSamples: number;
  private frame = 0; // samples gathered in the current frame
  private sumSquares = 0;
  private elapsedMs = 0;
  private floor = 0;
  private floorFrames = 0;
  private speechMs = 0;
  private lastSpeechAt = Number.NEGATIVE_INFINITY;
  private started = false;
  private result: EndpointStatus | null = null;

  constructor(sampleRate: number, options: EndpointOptions = {}) {
    this.o = { ...ENDPOINT_DEFAULTS, ...options };
    this.frameSamples = Math.max(1, Math.round((sampleRate * this.o.frameMs) / 1000));
  }

  /** Feed microphone samples (16-bit); returns the status after them. Final once decided. */
  push(samples: Int16Array): EndpointStatus {
    if (this.result) return this.result;
    for (let i = 0; i < samples.length; i++) {
      const v = (samples[i] ?? 0) / 32768;
      this.sumSquares += v * v;
      this.frame += 1;
      if (this.frame >= this.frameSamples) {
        this.endFrame(Math.sqrt(this.sumSquares / this.frame));
        this.frame = 0;
        this.sumSquares = 0;
        if (this.result) return this.result;
      }
    }
    return this.started ? "speaking" : "waiting";
  }

  private endFrame(rms: number): void {
    this.elapsedMs += this.o.frameMs;
    // The room's background: the loudness of the first moments, while still quiet.
    if (this.elapsedMs <= this.o.calibrateMs && rms < this.o.minThreshold * 2) {
      this.floor = (this.floor * this.floorFrames + rms) / (this.floorFrames + 1);
      this.floorFrames += 1;
    }
    const threshold = Math.max(this.o.minThreshold, this.floor * this.o.floorMultiple);
    if (rms > threshold) {
      this.speechMs += this.o.frameMs;
      this.lastSpeechAt = this.elapsedMs;
      if (this.speechMs >= this.o.minSpeechMs) this.started = true;
    }
    if (this.started && this.elapsedMs - this.lastSpeechAt >= this.o.endSilenceMs) {
      this.result = "ended";
    } else if (!this.started && this.elapsedMs >= this.o.noSpeechMs) {
      this.result = "no-speech";
    } else if (this.elapsedMs >= this.o.maxMs) {
      this.result = this.started ? "ended" : "no-speech";
    }
  }
}
