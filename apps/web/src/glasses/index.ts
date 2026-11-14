// Glasses layer entry point. The app imports from here and only sees GlassesAdapter.
//
//   adapter.ts      GlassesAdapter interface (SIMULATION_FEATURES.md section 6)
//   web-simulator/  WebSimulatorAdapter: browser camera/mic/speaker + keys (the only place that
//                   may touch browser media APIs)
//   simulator-ui/   Ray-Ban Display simulator panel (600x600, right lens) and control strip
//   meta-dat/       MetaDatAdapter stub for real glasses via Meta DAT (later)
export * from "./adapter";
export { createGlassesAdapter, glasses, GlassesContext, useGlasses } from "./context";
export { GlassesPanel } from "./GlassesPanel";
