// Simulator-only views. On real glasses the display is on the user's face and the controls do
// not exist, so both render nothing for any adapter other than the web simulator.
import { useEffect } from "react";

import { handsFeed } from "@/vision/handTracking";

import { useGlasses, useRecreateGlasses } from "./context";
import { GlassesControls } from "./simulator-ui/GlassesControls";
import { GlassesHud } from "./simulator-ui/GlassesHud";
import { WebSimulatorAdapter } from "./web-simulator/WebSimulatorAdapter";

/** The simulated glasses display, drawn over the camera view. */
export function GlassesHudLayer() {
  const adapter = useGlasses();
  // The simulated band watches the camera's hands (a real MetaDatAdapter gets band events).
  useEffect(() => {
    if (adapter instanceof WebSimulatorAdapter) return adapter.attachCameraGestures(handsFeed);
  }, [adapter]);
  if (!(adapter instanceof WebSimulatorAdapter)) return null;
  return <GlassesHud adapter={adapter} />;
}

/** Simulator controls: gestures, system events, display stats, audio-only mode. */
export function GlassesControlsPanel() {
  const adapter = useGlasses();
  const recreate = useRecreateGlasses();
  if (!(adapter instanceof WebSimulatorAdapter)) return null;
  return <GlassesControls adapter={adapter} onRecreate={recreate} />;
}
