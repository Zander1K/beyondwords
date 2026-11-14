export {
  analyzePage,
  type AskRequest,
  type AskResponse,
  askQuestion,
  ApiError,
  defineWordRemote,
  type DefineWordResponse,
  getHealth,
  illustrate,
  type IllustrateResponse,
  loginUser,
  saveOnboarding,
  type GlassesKind,
  type OnboardingAnswers,
  type Profile,
  type ProfileSpacing,
  type SupportLevel,
  type HealthResponse,
} from "./client";
export { type AnalyzeLine } from "./mock";
export {
  fetchIllustration,
  fetchWordCard,
  isLoading,
  LOADING_SHORT,
  willIllustrate,
  wordCardNow,
} from "./words";
export { type ApiStatus, useApiStatus } from "./useApiStatus";
export { getApiContext, setApiBook, setApiUser, withBook } from "./context";
export {
  addBookByIsbn,
  type BookInfo,
  listBooks,
  listWords,
  openBook,
  recordWord,
  resetRecordedWords,
  type ScanResult,
  scanBook,
  type WordBankItem,
} from "./library";
export { wordsAskedAbout } from "./askedWords";
export { frameToJpeg, preparePhoto } from "./photo";
