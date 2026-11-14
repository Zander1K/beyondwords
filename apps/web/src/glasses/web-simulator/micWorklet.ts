// Mic capture for the simulator: an AudioWorklet that forwards mono float frames to the main
// thread, where they are converted to 16-bit PCM for GlassesAdapter.startMic().

/** Worklet source, loaded from a Blob URL so it needs no separate build entry. */
export const MIC_WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

/** Float samples in [-1, 1] to signed 16-bit PCM (clamped). */
export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
