// Reader controller: glasses input -> reader store -> what the glasses show and say.
// Talks to the glasses only through GlassesAdapter; reader state lives in the app store
// (SIM-SES-07), so the glasses keep no app state and everything is re-sent when they come back.
// The page comes from the camera scan; a demo page is shown until the first scan.
import { useEffect, useRef, useState } from "react";

import {
  type GlassesAdapter,
  type GlassesGesture,
  type SessionEvent,
  type StatusKind,
  useGlasses,
} from "@/glasses";
import { CARD_ACTIONS, currentPhrase, type Page, type ReaderState } from "@/reader";
import { type ScanState, useReaderStore } from "@/state";

export interface Notice {
  text: string;
  tone: "info" | "warn";
}

/** Send the whole current reader view to the glasses (each call replaces the display). */
export function renderReader(glasses: GlassesAdapter, page: Page, reader: ReaderState): void {
  const phrase = currentPhrase(page, reader.position);
  if (!phrase) {
    glasses.clearDisplay();
  } else if (reader.view === "card" && phrase.hardWord) {
    glasses.showWordCard({
      ...phrase.hardWord.card,
      actions: [...CARD_ACTIONS],
      focused: CARD_ACTIONS[reader.cardFocus],
    });
  } else {
    glasses.showPhrase(phrase.text, { emphasis: phrase.hardWord?.range });
  }
}

/** The small status icon on the glasses for the current reading state. */
export function statusFor(scan: ScanState, handLost = false): StatusKind | null {
  if (handLost) return "hand-lost";
  if (scan.status === "scanning") return "thinking";
  if (scan.status === "empty" || scan.status === "error") return "no-page";
  return null;
}

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

  // Send the current view whenever it changes or the display comes back (start, resume, wake,
  // reconnect). The glasses keep no app state, so this is always the whole scene.
  useEffect(() => {
    if (session !== "started" || asleep) return;
    renderReader(glasses, page, reader);
    glasses.showStatus(statusFor(scan, handLost));
  }, [glasses, page, reader, session, asleep, scan, handLost]);

  // ---- gestures ----

  /** Apply a reader action and give feedback. Used by glasses gestures and phone buttons. */
  const act = (gesture: GlassesGesture) => {
    const step = store().applyGesture(gesture);
    const outcome = step.outcome;
    if (outcome === "boundary" || outcome === "no-word") {
      glasses.playCue("error");
    } else if (typeof outcome === "object" && outcome.action === "hear") {
      const card = currentPhrase(store().page, step.state.position)?.hardWord?.card;
      if (card) void glasses.speak(`${card.word}. ${card.short}`);
    } else if (outcome === "moved" && !glasses.capabilities.display) {
      glasses.playCue("tick");
    }
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
    },
  };
}
