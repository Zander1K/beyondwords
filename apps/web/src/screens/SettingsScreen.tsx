// Settings: reading spacing (spacing-first typography) and backend connection status.
// TODO(alex): fading-support controls (build order step 8), so the user stays in control.
import { useEffect, useState } from "react";

import { getHealth, type HealthResponse } from "@/api";
import { API_BASE_URL } from "@/config";
import { REMOTE_PREFIX, useVoices } from "@/glasses";
import { SPACING_RANGES, type SpacingSettings, useSettings } from "@/state";

import styles from "./SettingsScreen.module.css";

const LABELS: Record<keyof SpacingSettings, { label: string; unit: string }> = {
  fontSize: { label: "Text size", unit: "rem" },
  letterSpacing: { label: "Letter spacing", unit: "em" },
  wordSpacing: { label: "Word spacing", unit: "em" },
  lineHeight: { label: "Line spacing", unit: "×" },
};

/** What a voice preview says. */
const VOICE_SAMPLE = "The old lighthouse stood alone at the edge of the grey cliffs.";

/** The voice library: choose how read-aloud sounds, and how fast. */
function VoiceSettings() {
  const lib = useVoices();
  const [allLanguages, setAllLanguages] = useState(false);
  if (!lib.available) return null;

  // The first voice's language is the reader's own (the library lists theirs first).
  const own = lib.voices[0]?.lang.slice(0, 2);
  const shown = allLanguages ? lib.voices : lib.voices.filter((v) => v.lang.slice(0, 2) === own);
  const best = lib.voices[0];
  const hasRemote = lib.remoteVoices.length > 0;

  return (
    <section className={styles.card}>
      <h2>Voice</h2>
      <p className={styles.note}>
        How read-aloud sounds.{" "}
        {hasRemote
          ? "ElevenLabs voices are the most natural. The others come from your browser and computer."
          : "Voices come from your browser and computer; the ones marked Natural sound the most lifelike."}
      </p>
      {lib.voices.length === 0 && !hasRemote ? (
        <p role="status">
          No voices found yet. If this stays empty, try Chrome, Edge or Safari, or add a voice in
          your system settings.
        </p>
      ) : (
        <>
          <div className={styles.voice} data-selected={lib.selected === null}>
            <label>
              <input
                type="radio"
                name="voice"
                checked={lib.selected === null}
                onChange={() => lib.choose(null)}
              />
              <span>
                Best available
                {hasRemote ? " (ElevenLabs)" : best ? ` (${best.name})` : ""}
                <span className={styles.badge}>Recommended</span>
              </span>
            </label>
            <button type="button" onClick={() => lib.preview(null, VOICE_SAMPLE)}>
              Play
            </button>
          </div>
          {lib.remoteVoices.map((v) => {
            const id = `${REMOTE_PREFIX}${v.id}`;
            return (
              <div key={id} className={styles.voice} data-selected={lib.selected === id}>
                <label>
                  <input
                    type="radio"
                    name="voice"
                    checked={lib.selected === id}
                    onChange={() => lib.choose(id)}
                  />
                  <span>
                    {v.name}
                    <span className={styles.badge}>ElevenLabs</span>
                  </span>
                </label>
                <button type="button" onClick={() => lib.preview(id, VOICE_SAMPLE)}>
                  Play
                </button>
              </div>
            );
          })}
          {shown.map((v) => (
            <div key={v.id} className={styles.voice} data-selected={lib.selected === v.id}>
              <label>
                <input
                  type="radio"
                  name="voice"
                  checked={lib.selected === v.id}
                  onChange={() => lib.choose(v.id)}
                />
                <span>
                  {v.name}
                  <span className={styles.meta}> {v.lang}</span>
                  {v.natural && <span className={styles.badge}>Natural</span>}
                </span>
              </label>
              <button type="button" onClick={() => lib.preview(v.id, VOICE_SAMPLE)}>
                Play
              </button>
            </div>
          ))}
          {lib.voices.length > shown.length || allLanguages ? (
            <button type="button" onClick={() => setAllLanguages((a) => !a)}>
              {allLanguages ? "Only my language" : "Show other languages"}
            </button>
          ) : null}
        </>
      )}
      <label className={styles.slider}>
        <span>Speed: {lib.rate.toFixed(2)}×</span>
        <input
          type="range"
          min={0.6}
          max={1.4}
          step={0.05}
          value={lib.rate}
          onChange={(e) => lib.setRate(Number(e.target.value))}
        />
      </label>
      <button type="button" onClick={() => lib.preview(lib.selected, VOICE_SAMPLE)}>
        Play a sample
      </button>
    </section>
  );
}

type Health = { kind: "checking" } | { kind: "ok"; body: HealthResponse } | { kind: "down" };

function useApiHealth(): [Health, () => void] {
  const [health, setHealth] = useState<Health>({ kind: "checking" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getHealth(controller.signal)
      .then((body) => setHealth({ kind: "ok", body }))
      .catch(() => {
        if (!controller.signal.aborted) setHealth({ kind: "down" });
      });
    return () => controller.abort();
  }, [attempt]);
  const retry = () => {
    setHealth({ kind: "checking" });
    setAttempt((n) => n + 1);
  };
  return [health, retry];
}

export function SettingsScreen() {
  const spacing = useSettings((s) => s.spacing);
  const setSpacing = useSettings((s) => s.setSpacing);
  const resetSpacing = useSettings((s) => s.resetSpacing);
  const [health, retry] = useApiHealth();

  return (
    <div className={styles.settings}>
      <h1>Settings</h1>

      <section className={styles.card}>
        <h2>Reading spacing</h2>
        <p className={styles.sample}>The old lighthouse stood alone at the edge of the cliffs.</p>
        {(Object.keys(LABELS) as (keyof SpacingSettings)[]).map((key) => {
          const range = SPACING_RANGES[key];
          return (
            <label key={key} className={styles.slider}>
              <span>
                {LABELS[key].label}: {spacing[key].toFixed(2)}
                {LABELS[key].unit}
              </span>
              <input
                type="range"
                min={range.min}
                max={range.max}
                step={range.step}
                value={spacing[key]}
                onChange={(e) => setSpacing({ [key]: Number(e.target.value) })}
              />
            </label>
          );
        })}
        <button type="button" onClick={resetSpacing}>
          Reset to defaults
        </button>
      </section>

      <VoiceSettings />

      <section className={styles.card}>
        <h2>Connection</h2>
        <p>
          API: <code>{API_BASE_URL}</code>
        </p>
        <p role="status" data-testid="api-status">
          {health.kind === "checking" && "Checking…"}
          {health.kind === "ok" &&
            `Connected to ${health.body.app}. Database: ${health.body.database}.`}
          {health.kind === "down" &&
            "Can't reach the API. Reading still works; start it with `make api` or `make dev`."}
        </p>
        <button type="button" onClick={retry}>
          Check again
        </button>
      </section>
    </div>
  );
}
