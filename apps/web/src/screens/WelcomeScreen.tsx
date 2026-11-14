// First-run setup ("welcome"): a new reader says how much help to start with, which glasses they
// have, and how they like text spaced. It is saved to their profile (PUT /users/{id}/onboarding)
// so the app can fit them and track their progression from a real starting point (the starting
// support level is logged as the first reading event). Copy says "comfortable reading", never
// therapy (CLAUDE.md section 8). Re-open it any time at /welcome.
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { AFTER_SIGN_IN, useAccess } from "@/access";
import { type GlassesKind, type ProfileSpacing, saveOnboarding, type SupportLevel } from "@/api";
import { APP_NAME } from "@/config";
import { SPACING_RANGES, type SpacingSettings, useSettings } from "@/state";

import styles from "./WelcomeScreen.module.css";

const LEVELS: { value: SupportLevel; title: string; text: string }[] = [
  {
    value: "listen",
    title: "Read it to me first",
    text: "Each phrase is read aloud while you follow along on the page.",
  },
  {
    value: "read_along",
    title: "Read along with me",
    text: "You read. The highlight follows your finger, and help is ready for hard words.",
  },
  {
    value: "solo",
    title: "I'll read on my own",
    text: "Quiet by default. Help only when you ask for it.",
  },
];

const GLASSES: { value: GlassesKind | "none"; title: string; text: string }[] = [
  { value: "display", title: "Meta Ray-Ban Display", text: "Shows the phrase on a small display." },
  { value: "gen2", title: "Ray-Ban Meta (Gen 2)", text: "No display, so help comes as audio." },
  { value: "none", title: "No glasses yet", text: "I'm trying the web demo." },
];

const toApiSpacing = (s: SpacingSettings): ProfileSpacing => ({
  letter_spacing: s.letterSpacing,
  word_spacing: s.wordSpacing,
  line_height: s.lineHeight,
  font_size: s.fontSize,
});

const SLIDERS: { key: keyof SpacingSettings; label: string }[] = [
  { key: "fontSize", label: "Text size" },
  { key: "letterSpacing", label: "Space between letters" },
  { key: "wordSpacing", label: "Space between words" },
  { key: "lineHeight", label: "Space between lines" },
];

export function WelcomeScreen() {
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: unknown } | null)?.from;
  const destination =
    typeof from === "string" && from.startsWith("/") && from !== "/welcome" ? from : AFTER_SIGN_IN;

  const user = useAccess((s) => s.user);
  const profile = useAccess((s) => s.profile);
  const setProfile = useAccess((s) => s.setProfile);
  const skipOnboarding = useAccess((s) => s.skipOnboarding);
  const spacing = useSettings((s) => s.spacing);
  const setSpacing = useSettings((s) => s.setSpacing);

  const [level, setLevel] = useState<SupportLevel>(profile?.support_level ?? "read_along");
  const [glasses, setGlasses] = useState<GlassesKind | "none">(profile?.glasses_type ?? "none");
  const [name, setName] = useState(profile?.display_name ?? "");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const finish = async () => {
    if (!profile) return; // the server has not answered yet; the button is disabled until it has
    setSaving(true);
    setFailed(false);
    try {
      const saved = await saveOnboarding(profile.id, {
        support_level: level,
        glasses_type: glasses === "none" ? null : glasses,
        display_name: name.trim() || null,
        spacing: toApiSpacing(spacing),
      });
      setProfile(saved);
      navigate(destination, { replace: true });
    } catch {
      setFailed(true);
      setSaving(false);
    }
  };

  const skip = () => {
    skipOnboarding();
    navigate(destination, { replace: true });
  };

  return (
    <main className={styles.page}>
      <h1>Welcome{name.trim() ? `, ${name.trim()}` : user ? `, ${user}` : ""}</h1>
      <p className={styles.lede}>
        Three quick choices so {APP_NAME} fits the way you read. You can change them later.
      </p>

      <fieldset className={styles.group}>
        <legend>How much help would you like to start with?</legend>
        {LEVELS.map((o) => (
          <label key={o.value} className={styles.option} data-checked={level === o.value}>
            <input
              type="radio"
              name="level"
              checked={level === o.value}
              onChange={() => setLevel(o.value)}
            />
            <span>
              <strong>{o.title}</strong>
              <span className={styles.hint}>{o.text}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Which glasses do you use?</legend>
        {GLASSES.map((o) => (
          <label key={o.value} className={styles.option} data-checked={glasses === o.value}>
            <input
              type="radio"
              name="glasses"
              checked={glasses === o.value}
              onChange={() => setGlasses(o.value)}
            />
            <span>
              <strong>{o.title}</strong>
              <span className={styles.hint}>{o.text}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className={styles.group}>
        <legend>How do you like text spaced?</legend>
        <p className={styles.sample}>The old lighthouse stood alone at the edge of the cliffs.</p>
        {SLIDERS.map(({ key, label }) => {
          const range = SPACING_RANGES[key];
          return (
            <label key={key} className={styles.slider}>
              <span>{label}</span>
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
      </fieldset>

      <label className={styles.name}>
        <span>What should we call you? (optional)</span>
        <input
          type="text"
          value={name}
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
          autoComplete="given-name"
        />
      </label>

      {failed && (
        <p role="alert" className={styles.error}>
          Could not save that. Check the connection and try again, or skip for now.
        </p>
      )}

      <div className={styles.actions}>
        <button type="button" onClick={() => void finish()} disabled={!profile || saving}>
          {saving ? "Saving…" : "Start reading"}
        </button>
        <button type="button" className={styles.skip} onClick={skip}>
          Skip for now
        </button>
      </div>
      {!profile && (
        <p className={styles.hint} role="status">
          Connecting to your profile… you can skip and come back later.
        </p>
      )}
    </main>
  );
}
