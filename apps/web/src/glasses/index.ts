// Glasses layer entry point. The app imports from here and only sees GlassesAdapter.
//
//   adapter.ts      GlassesAdapter interface (SIMULATION_FEATURES.md section 6)
//   web-simulator/  WebSimulatorAdapter: browser camera/mic/speaker + keys (the only place that
//                   may touch browser media APIs)
//   simulator-ui/   Ray-Ban Display simulator panel (600x600, right lens) and control strip
//   meta-dat/       MetaDatAdapter stub for real glasses via Meta DAT (later)
export * from "./adapter";
export {
  createGlassesAdapter,
  GlassesContext,
  type GlassesContextValue,
  useGlasses,
  useRecreateGlasses,
} from "./context";
export { GlassesControlsPanel, GlassesHudLayer } from "./GlassesPanel";
export { GlassesProvider } from "./GlassesProvider";
export { useControlsShortcut } from "./useControlsShortcut";
export { useNoteActivity } from "./useNoteActivity";
export {
  REMOTE_PREFIX,
  type RemoteVoice,
  useVoices,
  type VoiceInfo,
  type VoiceLibrary,
} from "./useVoices";
export {
  HearingError,
  type HearingProblem,
  type SpeechInput,
  useSpeechInput,
} from "./useSpeechInput";
export { useWakeWord, type WakeProblem, type WakeWord } from "./useWakeWord";
export { useSpeechStatus } from "./useSpeechStatus";
