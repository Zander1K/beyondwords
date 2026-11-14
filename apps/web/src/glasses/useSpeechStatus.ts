// Can the reader hear speech right now? "blocked" = the browser is refusing sound until the page
// is clicked (it then speaks by itself); "issue" = no voice is available anywhere. Both are shown
// as a notice, so speech is never silent without saying why.
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { useGlasses } from "./context";
import { WebSimulatorAdapter } from "./web-simulator/WebSimulatorAdapter";

const NONE = createStore<{ audioBlocked: boolean; speechIssue: string | null }>(() => ({
  audioBlocked: false,
  speechIssue: null,
}));

export function useSpeechStatus(): { blocked: boolean; issue: string | null } {
  const adapter = useGlasses();
  const store = adapter instanceof WebSimulatorAdapter ? adapter.store : NONE;
  return {
    blocked: useStore(store, (s) => s.audioBlocked),
    issue: useStore(store, (s) => s.speechIssue),
  };
}
