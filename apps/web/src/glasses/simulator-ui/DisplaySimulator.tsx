// The glasses simulator panel:
//   - the glasses frame with its privacy LED and device status (battery, volume, link)
//   - the Ray-Ban Display: 600x600 inside a right-lens field-of-view frame
//   - hardware controls: Meta Neural Band, temple touchpad, capture button
//   - voice: push-to-talk state, optional wake phrase, typed command box
//   - device state switches: worn, folded, connected, battery, audio-only (Gen 2)
//
// HACK: the lens frame proportions and the display's offset inside it are illustrative only.
// OPEN QUESTION: exact placement of the display in the right lens (Meta display docs).
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import { type DeviceInput, INPUT_LABELS } from "../web-simulator/gestures";
import { WAKE_PHRASE } from "../web-simulator/voice";
import type { WebSimulatorAdapter } from "../web-simulator/WebSimulatorAdapter";
import type { DisplayContent } from "./displayModel";
import styles from "./DisplaySimulator.module.css";
import { isDisplayOn } from "./simulatorStore";

const BAND_INPUTS: readonly DeviceInput[] = [
  "band-swipe-back",
  "band-index-pinch",
  "band-swipe-forward",
  "band-middle-pinch",
  "band-twist-down",
  "band-twist-up",
];
const TOUCHPAD_INPUTS: readonly DeviceInput[] = [
  "touchpad-tap",
  "touchpad-swipe-back",
  "touchpad-swipe-forward",
  "touchpad-hold",
];

const INPUT_MEANING: Record<DeviceInput, string> = {
  "band-swipe-back": "previous phrase",
  "band-index-pinch": "select / word card",
  "band-swipe-forward": "next phrase",
  "band-middle-pinch": "back / dismiss",
  "band-twist-down": "volume down",
  "band-twist-up": "volume up",
  "touchpad-tap": "read aloud / stop",
  "touchpad-swipe-back": "volume down",
  "touchpad-swipe-forward": "volume up",
  "touchpad-hold": "speak a command",
  "capture-press": "photo of the page",
};

function Viewfinder({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    return () => {
      video.srcObject = null;
    };
  }, [stream]);
  if (!stream) return <p className={styles.short}>Camera off</p>;
  return (
    <div className={styles.viewfinder}>
      <video ref={ref} autoPlay playsInline muted className={styles.viewfinderVideo} />
      <span className={styles.viewfinderHint}>Line up the page · press capture</span>
    </div>
  );
}

function Content({ content, stream }: { content: DisplayContent; stream: MediaStream | null }) {
  switch (content.kind) {
    case "phrase": {
      if (!content.emphasis) return <p className={styles.phrase}>{content.text}</p>;
      const [start, end] = content.emphasis;
      return (
        <p className={styles.phrase}>
          {content.text.slice(0, start)}
          <mark className={styles.emphasis}>{content.text.slice(start, end)}</mark>
          {content.text.slice(end)}
        </p>
      );
    }
    case "word":
      return (
        <div className={styles.wordCard}>
          <p className={styles.word}>{content.word}</p>
          <p className={styles.short}>{content.short}</p>
        </div>
      );
    case "image":
      return <img className={styles.image} src={content.url} alt="" />;
    case "viewfinder":
      return <Viewfinder stream={stream} />;
  }
}

function InputButton({ adapter, input }: { adapter: WebSimulatorAdapter; input: DeviceInput }) {
  const { label, key } = INPUT_LABELS[input];
  return (
    <button
      type="button"
      className={styles.inputButton}
      onClick={() => adapter.press(input)}
      title={INPUT_MEANING[input]}
    >
      <span>
        {label} {key && <kbd>{key}</kbd>}
      </span>
      <span className={styles.meaning}>{INPUT_MEANING[input]}</span>
    </button>
  );
}

function TypedCommand({ adapter }: { adapter: WebSimulatorAdapter }) {
  const [text, setText] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    adapter.simulateUtterance(text);
    setText("");
  };
  return (
    <form className={styles.typed} onSubmit={submit}>
      <label htmlFor="sim-command" className={styles.visuallyHidden}>
        Typed voice command
      </label>
      <input
        id="sim-command"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='Type a command, e.g. "what does lamp mean"'
        autoComplete="off"
      />
      <button type="submit">Say</button>
    </form>
  );
}

export function DisplaySimulator({ adapter }: { adapter: WebSimulatorAdapter }) {
  const content = useStore(adapter.store, (s) => s.content);
  const audioOnly = useStore(adapter.store, (s) => s.audioOnly);
  const device = useStore(adapter.store, (s) => s.device);
  const stream = useStore(adapter.store, (s) => s.cameraStream);
  const listening = useStore(adapter.store, (s) => s.listening);
  const wakeListening = useStore(adapter.store, (s) => s.wakeListening);
  const lastCue = useStore(adapter.store, (s) => s.lastCue);
  const lastHeard = useStore(adapter.store, (s) => s.lastHeard);
  const flashAt = useStore(adapter.store, (s) => s.flashAt);
  const displayOn = useStore(adapter.store, isDisplayOn);
  const speechSupported = adapter.speechRecognitionSupported();

  return (
    <section className={styles.simulator} aria-label="Glasses simulator">
      {/* Glasses frame: privacy LED + status */}
      <div className={styles.frameBar}>
        <span
          key={flashAt ?? 0}
          className={`${styles.led} ${device.cameraActive ? styles.ledOn : ""} ${
            flashAt ? styles.ledFlash : ""
          }`}
          aria-label={device.cameraActive ? "Privacy LED on: camera in use" : "Privacy LED off"}
          role="img"
        />
        <span className={styles.frameText}>
          {device.cameraActive ? "Camera in use" : "Camera off"}
        </span>
        <span className={styles.frameText}>
          {device.connected ? "Connected" : "Disconnected"} · Battery {device.battery}% · Volume{" "}
          {Math.round(device.volume * 100)}%
        </span>
      </div>

      <div className={styles.lens}>
        <span className={styles.lensLabel}>Right lens · ~20° FOV</span>
        <div
          className={styles.display}
          data-testid="glasses-display"
          aria-live="polite"
          aria-label={displayOn ? "Glasses display" : "Display off"}
        >
          {displayOn && content && <Content content={content} stream={stream} />}
        </div>
        {lastCue && (
          // Keyed by time so the fade animation restarts on every cue.
          <span key={lastCue.at} className={styles.cue} role="status">
            ♪ {lastCue.kind}
          </span>
        )}
        {listening && (
          <span className={styles.listening} role="status">
            ● Listening…
          </span>
        )}
      </div>

      <div className={styles.controls}>
        <fieldset className={styles.group}>
          <legend>Meta Neural Band</legend>
          <div className={styles.inputs}>
            {BAND_INPUTS.map((input) => (
              <InputButton key={input} adapter={adapter} input={input} />
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.group}>
          <legend>Glasses: temple touchpad and capture button</legend>
          <div className={styles.inputs}>
            {TOUCHPAD_INPUTS.map((input) => (
              <InputButton key={input} adapter={adapter} input={input} />
            ))}
            <InputButton adapter={adapter} input="capture-press" />
          </div>
        </fieldset>

        <fieldset className={styles.group}>
          <legend>Voice</legend>
          <p className={styles.note}>
            Hold the touchpad (<kbd>V</kbd>) and speak, or type below.
            {speechSupported
              ? " Uses your browser's speech recognition (Chrome and Edge send audio to their speech service)."
              : " This browser has no speech recognition, so use the typed box."}
          </p>
          {speechSupported && (
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={wakeListening}
                onChange={(e) => adapter.setWakeListening(e.target.checked)}
              />
              Always listen for “{WAKE_PHRASE}” (simulator only)
            </label>
          )}
          <TypedCommand adapter={adapter} />
          {lastHeard && <p className={styles.note}>Last heard: “{lastHeard.text}”</p>}
        </fieldset>

        <fieldset className={styles.group}>
          <legend>Device state</legend>
          <div className={styles.toggles}>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={device.worn}
                onChange={(e) => adapter.setDevice({ worn: e.target.checked })}
              />
              Worn
            </label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={device.folded}
                onChange={(e) => adapter.setDevice({ folded: e.target.checked })}
              />
              Folded
            </label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={device.connected}
                onChange={(e) => adapter.setDevice({ connected: e.target.checked })}
              />
              Connected
            </label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={audioOnly}
                onChange={(e) => adapter.setAudioOnly(e.target.checked)}
              />
              Audio-only (Ray-Ban Meta Gen 2)
            </label>
          </div>
          <label className={styles.slider}>
            Battery {device.battery}%
            <input
              type="range"
              min={0}
              max={100}
              value={device.battery}
              onChange={(e) => adapter.setDevice({ battery: Number(e.target.value) })}
            />
          </label>
        </fieldset>
      </div>
    </section>
  );
}
