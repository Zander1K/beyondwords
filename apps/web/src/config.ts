// App-wide constants. CLAUDE.md: APP_NAME is the single place to rename the app; it comes from
// APP_NAME in the root .env at build time (see vite.config.ts).
export const APP_NAME: string = __APP_NAME__;

/** FastAPI base URL. Only VITE_* vars reach the browser; never put API keys here. */
export const API_BASE_URL: string = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000"
).replace(/\/+$/, "");
