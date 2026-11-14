import { type ReactNode, useMemo, useState } from "react";

import { createGlassesAdapter, GlassesContext } from "./context";

/** Owns the adapter instance. Recreating it disposes the old one; reader state is untouched. */
export function GlassesProvider({ children }: { children: ReactNode }) {
  const [adapter, setAdapter] = useState(createGlassesAdapter);
  const value = useMemo(
    () => ({
      adapter,
      recreate: () => {
        adapter.dispose();
        setAdapter(createGlassesAdapter());
      },
    }),
    [adapter],
  );
  return <GlassesContext.Provider value={value}>{children}</GlassesContext.Provider>;
}
