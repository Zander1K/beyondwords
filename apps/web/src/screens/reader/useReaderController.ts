// Reader controller: turns glasses input into what the glasses show and say, through
// GlassesAdapter only.
// HACK: demo phrases until page analysis exists. Step 2 moves reader state into the app store.
import { useEffect, useRef, useState } from "react";

import {
  GlassesError,
  type GlassesErrorCode,
  type GlassesGesture,
  type SessionState,
  useGlasses,
} from "@/glasses";
import { DEMO_PHRASES, initialReaderState, readerStep, toNavGesture } from "@/reader";

export type CameraStatus =
  | { kind: "off" }
  | { kind: "starting" }
  | { kind: "on"; stream: MediaStream }
  | { kind: "error"; code: GlassesErrorCode };

const hasWord = (i: number) => Boolean(DEMO_PHRASES[i]?.hardWord);

function errorCode(error: unknown): GlassesErrorCode {
  return error instanceof GlassesError ? error.code : "unknown";
}

export function useReaderController() {
  const glasses = useGlasses();
  const [reader, setReader] = useState(initialReaderState);
  const [session, setSession] = useState<SessionState>(glasses.session.state);
  const [camera, setCamera] = useState<CameraStatus>({ kind: "off" });
  const [capture, setCapture] = useState<{ url: string; at: number } | null>(null);
  const readerRef = useRef(reader);

  const current = DEMO_PHRASES[reader.index];

  const startSession = async () => {
    setSession("starting");
    await glasses.session.start();
    setSession(glasses.session.state);
  };

  const stopSession = async () => {
    setSession("stopping");
    await glasses.session.stop();
    setSession(glasses.session.state);
  };

  const startCamera = async () => {
    setCamera({ kind: "starting" });
    try {
      setCamera({ kind: "on", stream: await glasses.startCamera() });
    } catch (error) {
      setCamera({ kind: "error", code: errorCode(error) });
    }
  };

  const stopCamera = () => {
    if (camera.kind === "on") for (const t of camera.stream.getTracks()) t.stop();
    setCamera({ kind: "off" });
  };

  const capturePage = async () => {
    try {
      const blob = await glasses.captureStill();
      setCapture({ url: URL.createObjectURL(blob), at: Date.now() });
    } catch {
      glasses.playCue("error");
    }
  };

  function handleGesture(gesture: GlassesGesture): void {
    const step = readerStep(readerRef.current, toNavGesture(gesture), DEMO_PHRASES.length, hasWord);
    readerRef.current = step.state;
    setReader(step.state);
    if (step.outcome === "boundary" || step.outcome === "no-word") glasses.playCue("error");
    else if (!glasses.capabilities.display) glasses.playCue("tick");
  }

  const latest = useRef(handleGesture);
  useEffect(() => {
    latest.current = handleGesture;
  });
  useEffect(() => glasses.onGesture((g) => latest.current(g)), [glasses]);

  // Show the current view on the glasses while the session runs: one item at a time.
  useEffect(() => {
    if (session !== "started") return;
    const phrase = DEMO_PHRASES[reader.index];
    if (!phrase || reader.view === "cleared") glasses.clearDisplay();
    else if (reader.view === "word" && phrase.hardWord) glasses.showWordCard(phrase.hardWord.card);
    else glasses.showPhrase(phrase.text, { emphasis: phrase.hardWord?.range });
  }, [glasses, reader, session]);

  useEffect(() => () => (capture ? URL.revokeObjectURL(capture.url) : undefined), [capture]);

  return {
    reader,
    current,
    session,
    camera,
    capture,
    actions: { startSession, stopSession, startCamera, stopCamera, capturePage },
  };
}
