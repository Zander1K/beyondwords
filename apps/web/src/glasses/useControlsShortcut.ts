import { useEffect } from "react";

import { useGlasses } from "./context";
import { listenForControlsShortcut } from "./web-simulator/shortcuts";
import { WebSimulatorAdapter } from "./web-simulator/WebSimulatorAdapter";

/**
 * Calls `onToggle` when the simulator's controls shortcut (C) is pressed. Real glasses have no
 * keyboard, so this does nothing for any adapter other than the web simulator.
 */
export function useControlsShortcut(onToggle: () => void): void {
  const adapter = useGlasses();
  useEffect(() => {
    if (adapter instanceof WebSimulatorAdapter) return listenForControlsShortcut(onToggle);
  }, [adapter, onToggle]);
}
