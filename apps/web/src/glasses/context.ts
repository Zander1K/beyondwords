import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

import type { GlassesAdapter, GlassesState } from "./adapter";
import { WebSimulatorAdapter } from "./web-simulator/WebSimulatorAdapter";

/**
 * Which adapter the app runs on. Only the simulator exists today.
 * TODO(alex): pick MetaDatAdapter when a DAT bridge exists (see docs/glasses-adapter.md).
 */
export function createGlassesAdapter(): GlassesAdapter {
  return new WebSimulatorAdapter();
}

// One adapter for the whole app session (the glasses are a single device). Created at module
// load so React StrictMode's double mount does not create or dispose a second one.
export const glasses: GlassesAdapter = createGlassesAdapter();

export const GlassesContext = createContext<GlassesAdapter>(glasses);

/** The glasses, as the app sees them. Tests can swap in a fake via GlassesContext. */
export function useGlasses(): GlassesAdapter {
  return useContext(GlassesContext);
}

/** The glasses' physical state (worn, folded, battery, ...), re-rendering on change. */
export function useGlassesState(): GlassesState {
  const adapter = useGlasses();
  const subscribe = useCallback(
    (onChange: () => void) => adapter.onStateChange(onChange),
    [adapter],
  );
  const snapshot = () => adapter.state;
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
