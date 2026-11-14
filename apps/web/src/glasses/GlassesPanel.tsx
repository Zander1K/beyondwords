// Shows the simulated glasses when running on the web simulator; nothing on real glasses (the
// real display is on the user's face, not in the page).
import { useContext } from "react";

import { GlassesContext } from "./context";
import { DisplaySimulator } from "./simulator-ui/DisplaySimulator";
import { WebSimulatorAdapter } from "./web-simulator/WebSimulatorAdapter";

export function GlassesPanel() {
  const adapter = useContext(GlassesContext);
  if (!(adapter instanceof WebSimulatorAdapter)) return null;
  return <DisplaySimulator adapter={adapter} />;
}
