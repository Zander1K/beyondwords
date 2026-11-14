// Reader controller: turns glasses input (gestures, voice, camera) into what the glasses show and
// say. Talks to the glasses only through GlassesAdapter.
// HACK: demo phrases and canned word help until page analysis and the brain exist.
import { useEffect, useRef, useState } from "react";

import {
  type Gesture,
  GlassesError,
  type GlassesErrorCode,
  useGlasses,
  useGlassesState,
} from "@/glasses";
import { DEMO_PHRASES, initialReaderState, isNavGesture, readerStep } from "@/reader";
import { parseVoiceCommand, type VoiceCommand } from "@/voice/commands";

export type CameraStatus =
  | { kind: "off" }
  | { kind: "starting" }
  | { kind: "on"; stream: MediaStream }
  | { kind: "error"; code: GlassesErrorCode };

/** Something shown on the glasses on top of the reading view, until dismissed. */
type Overlay = { kind: "viewfinder" } | { kind: "capture"; url: string } | null;

export interface Notice {
  text: string;
  tone: "info" | "warn";
}

const CAPTURE_PREVIEW_MS = 1500;

const hasWord = (i: number) => Boolean(DEMO_PHRASES[i]?.hardWord);

function errorCode(error: unknown): GlassesErrorCode {
  return error instanceof GlassesError ? error.code : "unknown";
}

export function useReaderController() {
  const glasses = useGlasses();
  const device = useGlassesState();
  const [reader, setReader] = useState(initialReaderState);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [camera, setCamera] = useState<CameraStatus>({ kind: "off" });
  const [capture, setCapture] = useState<{ url: string; at: number } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [heard, setHeard] = useState<{ text: string; command: VoiceCommand } | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const readerRef = useRef(reader);
  const captureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The device can stop the camera (glasses folded or disconnected).
  const cameraOn = camera.kind === "on" && device.cameraActive;
  const cameraStoppedByDevice = camera.kind === "on" && !device.cameraActive;
  const paused = !device.worn || device.folded || !device.connected;
  const current = DEMO_PHRASES[reader.index];

  const moveTo = (next: typeof reader) => {
    readerRef.current = next;
    setReader(next);
  };

  // ---- actions ----

  const say = (text: string) => {
    setSpeaking(true);
    void glasses.speak(text).finally(() => setSpeaking(false));
  };

  const toggleRead = () => {
    if (speaking) {
      glasses.stopSpeaking();
      setSpeaking(false);
      return;
    }
    const phrase = DEMO_PHRASES[readerRef.current.index];
    if (phrase) say(phrase.text);
  };

  const startCamera = async () => {
    setCamera({ kind: "starting" });
    try {
      const stream = await glasses.startCamera();
      setCamera({ kind: "on", stream });
      // Show the viewfinder on the glasses so the user can line up the page.
      setOverlay({ kind: "viewfinder" });
      setNotice(null);
    } catch (error) {
      setCamera({ kind: "error", code: errorCode(error) });
    }
  };

  const stopCamera = () => {
    glasses.stopCamera();
    setCamera({ kind: "off" });
    setOverlay((o) => (o?.kind === "viewfinder" ? null : o));
  };

  const capturePage = async () => {
    if (!cameraOn) {
      glasses.playCue("error");
      setNotice({ text: "Start the camera before capturing a page.", tone: "warn" });
      return;
    }
    try {
      const blob = await glasses.capturePhoto();
      const url = URL.createObjectURL(blob);
      // Privacy: the photo lives in memory only; the previous one is freed (effect below).
      setCapture({ url, at: Date.now() });
      setOverlay({ kind: "capture", url });
      if (captureTimer.current) clearTimeout(captureTimer.current);
      captureTimer.current = setTimeout(() => setOverlay(null), CAPTURE_PREVIEW_MS);
      // TODO(alex): build order step 3: send the capture to OCR + /pages/analyze.
      setNotice({
        text: "Page captured. Reading its text arrives with OCR (next step).",
        tone: "info",
      });
    } catch (error) {
      glasses.playCue("error");
      setNotice({ text: error instanceof Error ? error.message : "Capture failed.", tone: "warn" });
    }
  };

  const defineWord = (word: string) => {
    const wanted = word.toLowerCase();
    const index = DEMO_PHRASES.findIndex((p) => p.hardWord?.card.word.toLowerCase() === wanted);
    const card = DEMO_PHRASES[index]?.hardWord?.card;
    if (!card) {
      // HACK: canned reply until word help (build order step 6) exists.
      say(`I can't explain "${word}" yet. Word help arrives when the reading brain is connected.`);
      return;
    }
    setOverlay(null);
    moveTo({ index, view: "word" });
    if (!glasses.capabilities.display) {
      glasses.playCue("ok");
      say(`${card.word}. ${card.short}`);
    }
  };

  const runCommand = (command: VoiceCommand) => {
    switch (command.kind) {
      case "next":
      case "prev":
      case "dismiss":
        handleGesture(command.kind);
        return;
      case "read":
        if (current) say(current.text);
        return;
      case "stop":
        glasses.stopSpeaking();
        setSpeaking(false);
        return;
      case "capture":
        void capturePage();
        return;
      case "viewfinder":
        if (cameraOn) setOverlay({ kind: "viewfinder" });
        else void startCamera();
        return;
      case "define":
        defineWord(command.word);
        return;
      case "unknown":
        // HACK: free-form questions go to Gemini Live (build order step 7).
        say("I can answer questions about the book once the assistant is connected.");
        return;
    }
  };

  const handleUtterance = (text: string) => {
    const command = parseVoiceCommand(text);
    setHeard({ text, command });
    runCommand(command);
  };

  const listen = async () => {
    try {
      const text = await glasses.listen();
      if (text) handleUtterance(text);
    } catch (error) {
      glasses.playCue("error");
      setNotice({
        text:
          errorCode(error) === "permission-denied"
            ? "Microphone access is blocked. Allow it for this site to use voice commands."
            : "Voice commands didn't work. Try the typed command box in the simulator.",
        tone: "warn",
      });
    }
  };

  function handleGesture(gesture: Gesture): void {
    if (gesture === "play-pause") return toggleRead();
    if (gesture === "capture") return void capturePage();
    if (gesture === "assistant") return void listen();
    if (!isNavGesture(gesture)) return;

    // Dismiss closes an overlay (viewfinder / capture preview) before anything else.
    if (overlay && gesture === "dismiss") {
      setOverlay(null);
      return;
    }
    setOverlay(null);
    const step = readerStep(readerRef.current, gesture, DEMO_PHRASES.length, hasWord);
    moveTo(step.state);

    if (step.outcome === "boundary" || step.outcome === "no-word") {
      glasses.playCue("error");
      return;
    }
    // With a display the change is visible. Without one (Gen 2), use cues and speech.
    if (glasses.capabilities.display) return;
    if (step.outcome === "word") {
      const card = DEMO_PHRASES[step.state.index]?.hardWord?.card;
      glasses.playCue("ok");
      if (card) say(`${card.word}. ${card.short}`);
    } else {
      glasses.playCue(step.outcome === "restored" ? "ok" : "tick");
    }
  }

  // ---- subscriptions ----
  // Glasses events always call the latest handlers (they close over current state).
  const latest = useRef({ gesture: handleGesture, utterance: handleUtterance });
  useEffect(() => {
    latest.current = { gesture: handleGesture, utterance: handleUtterance };
  });
  useEffect(() => {
    const offGesture = glasses.onGesture((g) => latest.current.gesture(g));
    const offUtterance = glasses.onUtterance((t) => latest.current.utterance(t));
    return () => {
      offGesture();
      offUtterance();
    };
  }, [glasses]);

  // Show the current view on the glasses: one item at a time.
  useEffect(() => {
    const phrase = DEMO_PHRASES[reader.index];
    if (overlay?.kind === "viewfinder") glasses.showViewfinder();
    else if (overlay?.kind === "capture") glasses.showImage(overlay.url);
    else if (!phrase || reader.view === "cleared") glasses.clearDisplay();
    else if (reader.view === "word" && phrase.hardWord) glasses.showWordCard(phrase.hardWord.card);
    else glasses.showPhrase(phrase.text, { emphasis: phrase.hardWord?.range });
  }, [glasses, reader, overlay]);

  // Leaving the Reader: stop the camera, clear the display, free the last capture.
  useEffect(
    () => () => {
      if (captureTimer.current) clearTimeout(captureTimer.current);
      glasses.stopCamera();
      glasses.stopSpeaking();
      glasses.clearDisplay();
    },
    [glasses],
  );
  useEffect(() => () => (capture ? URL.revokeObjectURL(capture.url) : undefined), [capture]);

  return {
    reader,
    current,
    device,
    paused,
    speaking,
    camera,
    cameraOn,
    cameraStoppedByDevice,
    capture,
    notice,
    heard,
    actions: {
      toggleRead,
      startCamera,
      stopCamera,
      capturePage,
      showViewfinder: () => (cameraOn ? setOverlay({ kind: "viewfinder" }) : void startCamera()),
      listen,
    },
  };
}
