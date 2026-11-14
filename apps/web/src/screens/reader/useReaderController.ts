// Reader controller: glasses input -> reader store -> what the glasses show and say.
// Talks to the glasses only through GlassesAdapter; reader state lives in the app store
// (SIM-SES-07), so the glasses keep no app state and everything is re-sent when they come back.
// The page comes from the camera scan (or the ebook); with no text there is nothing to show.
import { useEffect, useRef, useState } from "react";

import { askQuestion, recordWord, wordsAskedAbout } from "@/api";
import {
  type GlassesAdapter,
  type GlassesGesture,
  HearingError,
  type SessionEvent,
  type StatusKind,
  useGlasses,
  useSpeechInput,
  useWakeWord,
  type WakeProblem,
} from "@/glasses";
import {
  CARD_ACTIONS,
  currentPhrase,
  type Page,
  pointedWordInPhrase,
  type ReaderState,
} from "@/reader";
import { type ScanState, useReaderStore } from "@/state";

/** The page-gist card (shown on the display like a word card). */
export const PAGE_CARD_TITLE = "This page";
const PAGE_CARD_LOADING = "Reading the whole page…";
const PAGE_CARD_FAILED = "Couldn't read the page just now. Try again in a moment.";
const PAGE_QUESTION =
  "Give me the gist of this whole page in two short sentences, so I know the context before I read on.";

/** The card showing an answer to a spoken question. */
export const ANSWER_CARD_TITLE = "Answer";
const ANSWER_LOADING = "Thinking about that…";
const ANSWER_FAILED = "Couldn't answer just now. Try again in a moment.";
const HEARD_NOTHING = "I didn't catch that. Try again.";
const NO_MIC = "The microphone isn't available. Allow it for this site, then try again.";
const SPEECH_DOWN = "Couldn't hear you just now. Try again in a moment.";
const NOTHING_SAID = "I didn't hear a question. Say “Hey Meta” to try again.";
/** The chime is not part of the question: let it finish before the recording starts. */
const CHIME_MS = 350;
const HEY_META_KEY = "beyondwords.heyMeta";
const WAKE_PROBLEMS: Record<WakeProblem, string> = {
  unsupported:
    "“Hey Meta” needs a browser with speech recognition: Chrome, Edge or Safari (Brave blocks it).",
  denied: "“Hey Meta” needs the microphone. Allow it for this site, then switch it on again.",
  unavailable:
    "“Hey Meta” can't listen right now (the browser's speech service isn't available). Use the Ask button.",
};

function readHeyMeta(): boolean {
  try {
    return localStorage.getItem(HEY_META_KEY) === "on";
  } catch {
    return false;
  }
}

export interface Notice {
  text: string;
  tone: "info" | "warn";
}

/** What the glasses would show for this reader state, as a comparable key. */
export function readerViewKey(page: Page, reader: ReaderState): string {
  const phrase = currentPhrase(page, reader.position);
  if (!phrase) return "empty";
  if (reader.view === "card") {
    const card = reader.card ?? phrase.hardWord?.card;
    return `card|${card?.word ?? ""}|${card?.pronunciation ?? ""}|${card?.short ?? ""}|${card?.imageUrl ?? ""}|${card?.imageLoading ? "drawing" : ""}|${reader.cardFocus}`;
  }
  const emphasis = pointedWordInPhrase(page, reader.position) ?? phrase.hardWord?.range;
  return `phrase|${phrase.text}|${emphasis?.join(",") ?? ""}`;
}

/** Send the whole current reader view to the glasses (each call replaces the display). */
export function renderReader(glasses: GlassesAdapter, page: Page, reader: ReaderState): void {
  const phrase = currentPhrase(page, reader.position);
  if (!phrase) {
    glasses.clearDisplay();
  } else if (reader.view === "card" && (reader.card ?? phrase.hardWord)) {
    const card = reader.card ?? phrase.hardWord?.card;
    if (card) {
      glasses.showWordCard({
        ...card,
        actions: [...CARD_ACTIONS],
        focused: CARD_ACTIONS[reader.cardFocus],
      });
    }
  } else {
    // Highlight the word under the finger; without one, the phrase's hard word.
    const emphasis = pointedWordInPhrase(page, reader.position) ?? phrase.hardWord?.range;
    glasses.showPhrase(phrase.text, { emphasis });
  }
}

/**
 * The small status pill on the glasses for the current reading state. A short-lived `hint`
 * (nothing pointed at) wins, then failures, then what is going on.
 */
export function statusFor(
  scan: ScanState,
  handLost = false,
  hint: StatusKind | null = null,
  voice: "listening" | "thinking" | null = null,
): StatusKind | null {
  // Listening to a question, or working on it, is what the reader is waiting on: it comes first.
  if (voice) return voice;
  if (hint) return hint;
  if (scan.status === "error") return "load-failed";
  if (handLost) return "hand-lost";
  if (scan.status === "scanning") return "reading";
  if (scan.status === "empty") return "no-page";
  return null;
}

/** How long a hint ("point at a word first") stays on the glasses. */
export const HINT_MS = 2500;

const SESSION_NOTICES: Partial<Record<SessionEvent, Notice>> = {
  interrupted: {
    text: "The glasses display was interrupted (call or notification). Your place is saved.",
    tone: "warn",
  },
  resumed: { text: "Back on the glasses, at the same phrase.", tone: "info" },
  disconnected: {
    text: "Glasses disconnected. Reading continues here on the phone screen.",
    tone: "warn",
  },
  reconnected: { text: "Glasses reconnected. Your place has been restored.", tone: "info" },
};

export function useReaderController() {
  const glasses = useGlasses();
  const page = useReaderStore((s) => s.page);
  const reader = useReaderStore((s) => s.reader);
  const session = useReaderStore((s) => s.session);
  const offline = useReaderStore((s) => s.offline);
  const asleep = useReaderStore((s) => s.asleep);
  const scan = useReaderStore((s) => s.scan);
  const handLost = useReaderStore((s) => s.handLost);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Asking by voice: recording a question, then working out the answer.
  const [voice, setVoice] = useState<"starting" | "listening" | "thinking" | null>(null);
  const speechInput = useSpeechInput();
  // The latest voice state for callbacks that fire later (the silence detector, the wake phrase).
  const voiceRef = useRef<typeof voice>(null);
  const setVoiceState = (next: typeof voice) => {
    voiceRef.current = next;
    setVoice(next);
  };
  const [heyMeta, setHeyMetaState] = useState(readHeyMeta);
  // Why "Hey Meta" cannot listen, kept on screen until it is switched on again (a short-lived
  // notice is easy to miss, and then it just looks like it "doesn't stay on").
  const [heyMetaNote, setHeyMetaNote] = useState<string | null>(null);
  const setHeyMeta = (on: boolean) => {
    setHeyMetaState(on);
    try {
      localStorage.setItem(HEY_META_KEY, on ? "on" : "off");
    } catch {
      // Not remembered; it still applies for this visit.
    }
  };
  // A short-lived message on the glasses ("point at a word first"), cleared by a timer.
  const [hint, setHint] = useState<StatusKind | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showHint = (kind: StatusKind) => {
    clearTimeout(hintTimer.current);
    setHint(kind);
    hintTimer.current = setTimeout(() => setHint(null), HINT_MS);
  };
  useEffect(() => () => clearTimeout(hintTimer.current), []);

  const store = useReaderStore.getState;

  // ---- session ----

  const startSession = async () => {
    store().setSession("starting");
    try {
      await glasses.session.start();
      setNotice(null);
    } catch (error) {
      setNotice({
        text: error instanceof Error ? error.message : "The session could not start.",
        tone: "warn",
      });
    }
    store().setSession(glasses.session.state);
  };

  const stopSession = async () => {
    store().setSession("stopping");
    await glasses.session.stop();
    store().setSession(glasses.session.state);
  };

  // A new adapter (first mount or recreated) starts with no session: sync the app's view.
  useEffect(() => {
    const s = store();
    s.setSession(glasses.session.state);
    s.setOffline(false);
    s.setAsleep(false);
  }, [glasses, store]);

  useEffect(
    () =>
      glasses.onSessionEvent((event) => {
        const s = store();
        switch (event) {
          case "interrupted":
            s.setSession("stopped");
            break;
          case "resumed":
            s.setSession(glasses.session.state);
            break;
          case "slept":
            s.setAsleep(true);
            break;
          case "woke":
            s.setAsleep(false);
            break;
          case "disconnected":
            s.setOffline(true);
            s.setSession("stopped");
            break;
          case "reconnected":
            s.setOffline(false);
            s.setSession(glasses.session.state);
            break;
        }
        const message = SESSION_NOTICES[event];
        if (message) setNotice(message);
      }),
    [glasses, store],
  );

  // Send the current view whenever what the glasses show changes, or the display comes back
  // (start, resume, wake, reconnect: the glasses keep no app state). Continuous page reads
  // re-create the page about once a second; unchanged content is not re-sent (SIM-DSP-04: once
  // per phrase change, never per read).
  const lastSent = useRef<string | null>(null);
  useEffect(() => {
    if (session !== "started" || asleep) {
      lastSent.current = null; // force a full re-send when the display comes back
      return;
    }
    const status = statusFor(scan, handLost, hint, voice === "starting" ? null : voice);
    const key = `${readerViewKey(page, reader)}|${status ?? ""}`;
    if (key === lastSent.current) return;
    lastSent.current = key;
    renderReader(glasses, page, reader);
    glasses.showStatus(status);
  }, [glasses, page, reader, session, asleep, scan, handLost, hint, voice]);
  useEffect(() => {
    lastSent.current = null; // a new adapter shows nothing yet
  }, [glasses]);

  // ---- gestures ----

  /** Apply a reader action and give feedback. Used by glasses gestures and phone buttons. */
  const act = (gesture: GlassesGesture) => {
    const step = store().applyGesture(gesture);
    const outcome = step.outcome;
    if (outcome === "boundary" || outcome === "no-word") {
      glasses.playCue("error");
      // Say it on the display too: a sound alone does not tell you what to do.
      if (outcome === "no-word") showHint("no-word");
    } else if (typeof outcome === "object" && outcome.action === "hear") {
      const card =
        step.state.card ?? currentPhrase(store().page, step.state.position)?.hardWord?.card;
      // Nothing to read out when the card says the definition is missing.
      if (card?.problem) glasses.playCue("error");
      else if (card) void glasses.speak(`${card.word}. ${card.short}`);
    } else if (outcome === "moved" && !glasses.capabilities.display) {
      glasses.playCue("tick");
    }
  };

  /**
   * The whole-page gesture (or its button): ask the brain for the gist of the page and show it on
   * the display as a card ("Hear it" reads it out). Shows a placeholder at once, then the answer;
   * if the brain is slow or down, the card says so and reading carries on.
   */
  const askAboutPage = async () => {
    if (store().session !== "started") return;
    const { page, reader: at } = store();
    const lines = page.lines.slice(0, 80);
    if (!lines.length) {
      showHint("no-page");
      return;
    }
    store().showCard({ word: PAGE_CARD_TITLE, short: PAGE_CARD_LOADING });
    const stillAsking = () => {
      const now = store().reader;
      return now.view === "card" && now.card?.word === PAGE_CARD_TITLE;
    };
    try {
      const reply = await askQuestion({
        question: PAGE_QUESTION,
        page_lines: lines.map((l, i) => ({ id: `L${i + 1}`, text: l.text.slice(0, 1000) })),
        current_line_id: `L${at.position.line + 1}`,
      });
      if (stillAsking()) store().showCard({ word: PAGE_CARD_TITLE, short: reply.answer });
    } catch {
      if (stillAsking()) store().showCard({ word: PAGE_CARD_TITLE, short: PAGE_CARD_FAILED });
    }
  };

  /**
   * Ask a question out loud. It starts from the "Ask" button or by saying "Hey Meta", and ends by
   * itself when the reader stops talking (or on a second press of the button). The recording is
   * turned into text (ElevenLabs), the brain answers from the page, the answer shows on the
   * display and is read aloud. Every failure ends in a card that says what happened, and reading
   * carries on. ElevenLabs only ever hears the recording, never the waiting for "Hey Meta".
   */
  const showAnswerCard = (text: string) =>
    store().showCard({ word: ANSWER_CARD_TITLE, short: text });

  /** Start listening to a question. `source` "wake" = "Hey Meta" was said (chime first). */
  const beginAsk = async (source: "button" | "wake") => {
    if (voiceRef.current !== null) return;
    if (store().session !== "started") {
      if (source === "button") {
        setNotice({ text: "Start reading, then ask your question.", tone: "info" });
      }
      return;
    }
    glasses.stopSpeaking(); // do not talk over the question
    setVoiceState("starting"); // the browser may be asking for the microphone
    if (source === "wake") {
      glasses.playCue("ok"); // "go ahead"
      await new Promise((resolve) => setTimeout(resolve, CHIME_MS));
    }
    try {
      await speechInput.start((reason) => {
        if (voiceRef.current !== "listening") return;
        if (reason === "ended") void finishAsk();
        else cancelAsk(NOTHING_SAID);
      });
    } catch {
      setNotice({ text: NO_MIC, tone: "warn" });
      setVoiceState(null);
      return;
    }
    setVoiceState("listening");
  };

  /** Nothing was asked: drop the recording (nothing is sent) and say so. */
  const cancelAsk = (text: string) => {
    speechInput.cancel();
    setVoiceState(null);
    showAnswerCard(text);
  };

  /** The question is finished: transcribe it, ask the brain, show and speak the answer. */
  const finishAsk = async () => {
    if (voiceRef.current !== "listening") return;
    setVoiceState("thinking");
    const answerShown = () => {
      const now = store().reader;
      return now.view === "card" && now.card?.word === ANSWER_CARD_TITLE;
    };
    try {
      const question = await speechInput.stop();
      showAnswerCard(`“${question}” ${ANSWER_LOADING}`);
      const { page: current, reader: at } = store();
      const pointed =
        at.position.word !== undefined
          ? current.lines[at.position.line]?.words?.[at.position.word]?.text
          : undefined;
      // "What does portcullis mean?": the word asked about goes in the word bank, with its line.
      const pageWords = current.lines.flatMap(
        (l) => l.words?.map((w) => w.text) ?? l.text.split(" "),
      );
      for (const asked of wordsAskedAbout(question, pageWords, pointed)) {
        const line = current.lines.find((l) => l.text.toLowerCase().includes(asked));
        recordWord(asked, line?.text ?? "", "ask");
      }
      const reply = await askQuestion({
        question,
        page_lines: current.lines
          .slice(0, 80)
          .map((l, i) => ({ id: `L${i + 1}`, text: l.text.slice(0, 1000) })),
        current_line_id: `L${at.position.line + 1}`,
        ...(pointed ? { pointed_word: pointed.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "") } : {}),
      });
      if (answerShown()) showAnswerCard(reply.answer);
      void glasses.speak(reply.answer); // asked out loud, answered out loud
    } catch (error) {
      showAnswerCard(
        error instanceof HearingError
          ? error.problem === "no-speech"
            ? HEARD_NOTHING
            : error.problem === "no-microphone"
              ? NO_MIC
              : SPEECH_DOWN
          : ANSWER_FAILED,
      );
    } finally {
      setVoiceState(null);
    }
  };

  /** The "Ask" button: press to start listening; press again to finish early. */
  const askByVoice = async () => {
    if (voiceRef.current === null) await beginAsk("button");
    else if (voiceRef.current === "listening") await finishAsk();
  };

  // "Hey Meta": listen for it (browser speech recognition, not ElevenLabs) while reading with
  // nothing else going on. It stops while a question is being recorded, then resumes.
  const wake = useWakeWord(
    heyMeta && session === "started" && !offline && voice === null,
    () => void beginAsk("wake"),
    (problem, detail) => {
      setHeyMeta(false);
      setHeyMetaNote(`${WAKE_PROBLEMS[problem]} (${detail})`);
    },
  );
  const toggleHeyMeta = () => {
    setHeyMetaNote(null);
    if (heyMeta) {
      setHeyMeta(false);
      return;
    }
    if (!wake.supported) {
      setHeyMetaNote(WAKE_PROBLEMS.unsupported);
      return;
    }
    setHeyMeta(true);
    // It listens while reading: switching it on is a request to start (a click lets the
    // browser ask for the microphone).
    if (store().session === "stopped" && !store().offline) void startSession();
  };

  const onGesture = (gesture: GlassesGesture) => {
    // Reading does not begin until the user starts the session (SIM-SES-02).
    if (store().session !== "started") return;
    act(gesture);
  };

  const latest = useRef(onGesture);
  useEffect(() => {
    latest.current = onGesture;
  });
  useEffect(() => glasses.onGesture((g) => latest.current(g)), [glasses]);

  return {
    page,
    reader,
    session,
    offline,
    asleep,
    notice,
    actions: {
      startSession,
      stopSession,
      /** Phone-screen fallback navigation while the glasses are offline (SIM-SES-05). */
      phone: act,
      /** The whole-page gist: the rock-sign gesture and the "Page gist" button. */
      askAboutPage,
      /** Ask a question out loud: press to start listening, press again to stop and answer. */
      askByVoice,
    },
    /** What the voice question is doing now: starting, listening, thinking, or nothing. */
    voice,
    /** "Hey Meta": say it to start a question. Off until switched on. */
    heyMeta: {
      enabled: heyMeta,
      supported: wake.supported,
      /** "listening", "retrying" (the browser's speech service is failing for a moment), or null. */
      state: wake.state,
      /** Why it cannot listen, when it cannot. */
      note: heyMetaNote,
      toggle: toggleHeyMeta,
    },
  };
}
