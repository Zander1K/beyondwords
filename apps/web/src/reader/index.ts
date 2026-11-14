// Reader logic: highlight state machine, phrase pacing, read-along (phrase-level).
export { DEMO_PHRASES, type DemoPhrase } from "./demoPhrases";
export {
  initialReaderState,
  toNavGesture,
  type NavGesture,
  readerStep,
  type ReaderState,
  type ReaderStep,
  type ReaderView,
} from "./readerMachine";
