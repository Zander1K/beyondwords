// Gemini Live client: WebSocket to the backend `WS /live` and mic streaming.
// TODO(alex, with Mick Ola): build order step 7. Not implemented.
//  - Mic audio comes from GlassesAdapter.startMic() (PCM16), never from the browser directly.
//  - Stream it over WebSocket to `${API_BASE_URL}/live` (ws:// or wss://).
//  - The backend injects page/book context; the client re-sends the current page id on change.
//  - Auto-reconnect when the session expires (~10-15 min) (CLAUDE.md section 7).
// OPEN QUESTION: audio format Gemini Live expects from us (sample rate; resample here?).
// OPEN QUESTION: /live message protocol (owned by Mick Ola; not defined yet).

export interface LiveClient {
  connect(): Promise<void>;
  sendAudio(pcm: Int16Array): void;
  setPage(pageId: string): void;
  onAnswer(handler: (text: string) => void): () => void;
  close(): void;
}
