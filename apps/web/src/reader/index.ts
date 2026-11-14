// Reader logic: page model, highlight state machine (phrase-level), demo page.
export { DEMO_PAGE } from "./demoPhrases";
export { phraseSpan } from "./geometry";
export { type Box, line, type Page, type PageLine, phrase, type Phrase } from "./page";
export {
  CARD_ACTIONS,
  currentPhrase,
  initialReaderState,
  moveToLine,
  type ReaderOutcome,
  type ReaderPosition,
  readerStep,
  type ReaderState,
  type ReaderStep,
  type ReaderView,
} from "./readerMachine";
