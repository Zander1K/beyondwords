import { useEffect } from "react";

import { spacingToCssVars, useSettings } from "@/state";

/** Applies the user's spacing settings as CSS variables on <html>. Renders nothing. */
export function SpacingVars() {
  const spacing = useSettings((s) => s.spacing);
  useEffect(() => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(spacingToCssVars(spacing))) {
      root.style.setProperty(name, value);
    }
  }, [spacing]);
  return null;
}
