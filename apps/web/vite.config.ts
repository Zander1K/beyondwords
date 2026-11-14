/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";

import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// The repo keeps one `.env` at the root (see .env.example). Vite only exposes `VITE_*` vars to
// the bundle, so secrets in that file never reach the browser.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  // Read every var (prefix "") only to pick out APP_NAME; nothing else is passed to the bundle.
  const env = loadEnv(mode, repoRoot, "");
  const appName = env.APP_NAME || "Beyond Words";
  // LAN mode (`make web-lan`): reachable from phones on the same network. Phones only allow
  // the camera and mic over HTTPS, so this serves a self-signed certificate (accept the browser
  // warning once on the phone). Normal dev stays on localhost, which needs no HTTPS.
  const lan = process.env.LAN === "1";
  // Where the dev server forwards /api (the FastAPI server on this machine).
  const apiTarget = env.API_PROXY_TARGET || "http://localhost:8000";

  return {
    envDir: repoRoot,
    plugins: [
      react(),
      ...(lan ? [basicSsl({ name: "reading-companion-lan" })] : []),
      {
        // Puts APP_NAME into every %APP_NAME% placeholder in index.html (title, description).
        name: "app-name-title",
        transformIndexHtml: (html: string) => html.split("%APP_NAME%").join(appName),
      },
    ],
    define: {
      // CLAUDE.md: APP_NAME is the single place to rename the app. Not a secret.
      __APP_NAME__: JSON.stringify(appName),
    },
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      // localhost counts as a secure context, so getUserMedia works without HTTPS.
      host: lan ? true : "localhost",
      port: 5173,
      strictPort: true,
      // Same-origin API calls: /api/... -> FastAPI. Works from a phone, where "localhost" would
      // be the phone itself, and avoids mixed HTTPS/HTTP content. ws: true for /live later.
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          ws: true,
          rewrite: (path: string) => path.replace(/^\/api/, ""),
        },
      },
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
    },
  };
});
