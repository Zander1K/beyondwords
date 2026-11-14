// Reader: demo phrases driven by glasses gestures, shown on the (simulated) glasses display.
// HACK: hard-coded demo phrases until the page capture -> /pages/analyze slice exists.
import { useEffect, useRef, useState } from "react";

import { type Gesture, GlassesPanel, useGlasses } from "@/glasses";
import { DEMO_PHRASES, initialReaderState, readerStep, type ReaderStep } from "@/reader";

import { CameraPanel } from "./CameraPanel";
import styles from "./ReaderScreen.module.css";

const hasWord = (i: number) => Boolean(DEMO_PHRASES[i]?.hardWord);

export function ReaderScreen() {
  const glasses = useGlasses();
  const [state, setState] = useState(initialReaderState);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Gestures (Neural Band, or keys/buttons in the simulator) move through the phrases.
  useEffect(() => {
    const feedback = (step: ReaderStep) => {
      if (step.outcome === "boundary" || step.outcome === "no-word") {
        glasses.playCue("error");
        return;
      }
      // With a display the change is visible. Without one (Gen 2), use cues and speech.
      if (glasses.capabilities.display) return;
      if (step.outcome === "word") {
        const card = DEMO_PHRASES[step.state.index]?.hardWord?.card;
        glasses.playCue("ok");
        if (card) void glasses.speak(`${card.word}. ${card.short}`);
      } else {
        glasses.playCue(step.outcome === "restored" ? "ok" : "tick");
      }
    };
    const onGesture = (gesture: Gesture) => {
      const step = readerStep(stateRef.current, gesture, DEMO_PHRASES.length, hasWord);
      stateRef.current = step.state;
      setState(step.state);
      feedback(step);
    };
    return glasses.onGesture(onGesture);
  }, [glasses]);

  // Show the current reader view on the glasses: one item at a time.
  useEffect(() => {
    const current = DEMO_PHRASES[state.index];
    if (!current || state.view === "cleared") {
      glasses.clearDisplay();
    } else if (state.view === "word" && current.hardWord) {
      glasses.showWordCard(current.hardWord.card);
    } else {
      glasses.showPhrase(current.text, { emphasis: current.hardWord?.range });
    }
  }, [glasses, state]);

  useEffect(() => () => glasses.clearDisplay(), [glasses]);

  const current = DEMO_PHRASES[state.index];

  return (
    <div className={styles.reader}>
      <section className={styles.page} aria-label="Page">
        <h1>Reader</h1>
        <p className={styles.hint}>
          Use <kbd>←</kbd> <kbd>→</kbd> to move, <kbd>Enter</kbd> for the word, <kbd>Esc</kbd> to
          dismiss. These stand in for Neural Band gestures.
        </p>
        <p className={styles.text}>
          {DEMO_PHRASES.map((p, i) => (
            <span key={p.text} className={i === state.index ? styles.current : undefined}>
              {p.text}{" "}
            </span>
          ))}
        </p>
        <button
          type="button"
          onClick={() => {
            if (current) void glasses.speak(current.text);
          }}
        >
          Read this phrase aloud
        </button>
      </section>

      <section className={styles.glasses} aria-label="Glasses">
        <h2>Glasses</h2>
        <GlassesPanel />
      </section>

      <section className={styles.camera} aria-label="Camera">
        <h2>Camera</h2>
        <CameraPanel />
      </section>
    </div>
  );
}
