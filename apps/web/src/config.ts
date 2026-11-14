// App-wide constants. CLAUDE.md: APP_NAME is the single place to rename the app; it comes from
// APP_NAME in the root .env at build time (see vite.config.ts).
export const APP_NAME: string = __APP_NAME__;

/**
 * FastAPI base URL. Default "/api": the Vite dev server proxies it to FastAPI, which works on
 * localhost and from phones on the network. Set VITE_API_BASE_URL only for a different setup.
 * Only VITE_* vars reach the browser; never put API keys here.
 */
export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL || "/api").replace(
  /\/+$/,
  "",
);
