// Settings: reading spacing (spacing-first typography) and backend connection status.
// TODO(alex): fading-support controls (build order step 8), so the user stays in control.
import { useEffect, useState } from "react";

import { getHealth, type HealthResponse } from "@/api";
import { API_BASE_URL } from "@/config";
import { SPACING_RANGES, type SpacingSettings, useSettings } from "@/state";

import styles from "./SettingsScreen.module.css";

const LABELS: Record<keyof SpacingSettings, { label: string; unit: string }> = {
  fontSize: { label: "Text size", unit: "rem" },
  letterSpacing: { label: "Letter spacing", unit: "em" },
  wordSpacing: { label: "Word spacing", unit: "em" },
  lineHeight: { label: "Line spacing", unit: "×" },
};

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
