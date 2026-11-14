// Reading preferences (Zustand). Spacing-first typography: clean sans font with adjustable
// letter, word and line spacing (CLAUDE.md section 8). No dyslexia-specific fonts.
//
// Nothing to port from the mobile app: its state module was an empty placeholder.
// OPEN QUESTION: where preferences persist (users.settings in MariaDB? see docs/OPEN_QUESTIONS.md
// #4). In-memory only for now.
import { create } from "zustand";

export interface SpacingSettings {
  /** em */
  letterSpacing: number;
  /** em */
  wordSpacing: number;
  /** unitless multiple of font size */
  lineHeight: number;
  /** rem */
  fontSize: number;
}

export const SPACING_DEFAULTS: SpacingSettings = {
  letterSpacing: 0.05,
  wordSpacing: 0.16,
  lineHeight: 1.7,
  fontSize: 1.125,
};

export const SPACING_RANGES: Record<
  keyof SpacingSettings,
  { min: number; max: number; step: number }
> = {
  letterSpacing: { min: 0, max: 0.3, step: 0.01 },
  wordSpacing: { min: 0, max: 0.8, step: 0.02 },
  lineHeight: { min: 1.2, max: 2.6, step: 0.05 },
  fontSize: { min: 0.875, max: 1.75, step: 0.0625 },
};

interface SettingsState {
  spacing: SpacingSettings;
  setSpacing: (patch: Partial<SpacingSettings>) => void;
  resetSpacing: () => void;
}

export const useSettings = create<SettingsState>((set) => ({
  spacing: SPACING_DEFAULTS,
  setSpacing: (patch) => set((s) => ({ spacing: { ...s.spacing, ...patch } })),
  resetSpacing: () => set({ spacing: SPACING_DEFAULTS }),
}));

/** CSS custom properties the stylesheet reads (see src/ui/global.css). */
export function spacingToCssVars(s: SpacingSettings): Record<string, string> {
  return {
    "--reading-letter-spacing": `${s.letterSpacing}em`,
    "--reading-word-spacing": `${s.wordSpacing}em`,
    "--reading-line-height": `${s.lineHeight}`,
    "--reading-font-size": `${s.fontSize}rem`,
  };
}
