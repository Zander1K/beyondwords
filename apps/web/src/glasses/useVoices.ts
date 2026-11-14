// The voice library for the Settings screen: the voices on offer (best first), the reader's choice
// and speed, and a preview. The speaking itself is the adapter's (WebSimulatorAdapter.speak).
import { useCallback, useEffect, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { useGlasses } from "./context";
import { WebSimulatorAdapter } from "./web-simulator/WebSimulatorAdapter";
import { REMOTE_PREFIX, type RemoteVoice } from "./web-simulator/elevenLabs";
import type { VoiceInfo } from "./web-simulator/voices";

export type { RemoteVoice, VoiceInfo };
export { REMOTE_PREFIX };

/** A stand-in store for when there is no browser speaker, so the hooks below always run. */
const EMPTY_STORE = createStore<{ voiceId: string | null; speechRate: number }>(() => ({
  voiceId: null,
  speechRate: 1,
}));

export interface VoiceLibrary {
  /** False when the speaker is not the browser's (no voice choice to offer). */
  available: boolean;
  voices: VoiceInfo[];
  /** The ElevenLabs voices (empty when the service is not configured or not answering). */
  remoteVoices: RemoteVoice[];
  /** The saved choice (a voice id), or null for the best available. */
  selected: string | null;
  rate: number;
  choose: (id: string | null) => void;
  setRate: (rate: number) => void;
  /** Say something in a voice without changing the saved choice (null = the best available). */
  preview: (id: string | null, text: string) => void;
}

export function useVoices(): VoiceLibrary {
  const adapter = useGlasses();
  const sim = adapter instanceof WebSimulatorAdapter ? adapter : null;
  const [voices, setVoices] = useState<VoiceInfo[]>(() => sim?.listVoices() ?? []);
  // Browsers load their voices a moment after the page does.
  useEffect(() => {
    if (!sim) return;
    return sim.onVoicesChanged(() => setVoices(sim.listVoices()));
  }, [sim]);

  const [remoteVoices, setRemoteVoices] = useState<RemoteVoice[]>([]);
  useEffect(() => {
    let current = true;
    void sim?.loadRemoteVoices().then((found) => {
      if (current) setRemoteVoices(found);
    });
    return () => {
      current = false;
    };
  }, [sim]);

  const fallback = useStoreFallback(sim);
  const choose = useCallback((id: string | null) => sim?.setVoice(id), [sim]);
  const setRate = useCallback((rate: number) => sim?.setSpeechRate(rate), [sim]);
  const preview = useCallback(
    (id: string | null, text: string) => void sim?.speakWith(id, text),
    [sim],
  );
  return { available: sim !== null, voices, remoteVoices, ...fallback, choose, setRate, preview };
}

/** The saved choice and speed (reactive), or defaults when there is no browser speaker. */
function useStoreFallback(sim: WebSimulatorAdapter | null) {
  const store = sim?.store ?? EMPTY_STORE;
  const selected = useStore(store, (s) => s.voiceId);
  const rate = useStore(store, (s) => s.speechRate);
  return { selected, rate };
}
