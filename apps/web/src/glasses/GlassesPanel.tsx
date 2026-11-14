// Shows the simulated glasses when running on the web simulator; nothing on real glasses (the
// real display is on the user's face, not in the page).
import { useEffect } from "react";

import { handsFeed } from "@/vision/handTracking";

import { useGlasses, useRecreateGlasses } from "./context";
import { DisplaySimulator } from "./simulator-ui/DisplaySimulator";
import { WebSimulatorAdapter } from "./web-simulator/WebSimulatorAdapter";

export function GlassesPanel() {
  const adapter = useGlasses();
  const recreate = useRecreateGlasses();
  // The simulated band watches the camera's hands (a real MetaDatAdapter gets band events).
  useEffect(() => {
    if (adapter instanceof WebSimulatorAdapter) return adapter.attachCameraGestures(handsFeed);
  }, [adapter]);
  if (!(adapter instanceof WebSimulatorAdapter)) return null;
  return <DisplaySimulator adapter={adapter} onRecreate={recreate} />;
}
