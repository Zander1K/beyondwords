import { createContext, useContext } from "react";

import type { GlassesAdapter } from "./adapter";
import { WebSimulatorAdapter } from "./web-simulator/WebSimulatorAdapter";

/**
 * Which adapter the app runs on. Only the simulator exists today.
 * TODO(alex): pick MetaDatAdapter when a DAT bridge exists (see docs/glasses-adapter.md).
 */
export function createGlassesAdapter(): GlassesAdapter {
  return new WebSimulatorAdapter();
}

export interface GlassesContextValue {
  adapter: GlassesAdapter;
  /** Tear the adapter down and create a fresh one (SIM-SES-07 test). */
  recreate: () => void;
}

export const GlassesContext = createContext<GlassesContextValue | null>(null);

/** The glasses, as the app sees them. */
export function useGlasses(): GlassesAdapter {
  const value = useContext(GlassesContext);
  if (!value) throw new Error("useGlasses must be used inside <GlassesProvider>");
  return value.adapter;
}

export function useRecreateGlasses(): () => void {
  const value = useContext(GlassesContext);
  if (!value) throw new Error("useRecreateGlasses must be used inside <GlassesProvider>");
  return value.recreate;
}
