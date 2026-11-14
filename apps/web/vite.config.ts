/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// The repo keeps one `.env` at the root (see .env.example). Vite only exposes `VITE_*` vars to
// the bundle, so secrets in that file never reach the browser.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  // Read every var (prefix "") only to pick out APP_NAME; nothing else is passed to the bundle.
  const env = loadEnv(mode, repoRoot, "");
  const appName = env.APP_NAME || "Reading Companion";

  return {
    envDir: repoRoot,
    plugins: [
      react(),
      {
        // Puts APP_NAME into the <title> placeholder in index.html.
        name: "app-name-title",
        transformIndexHtml: (html: string) => html.replace("%APP_NAME%", appName),
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
      host: "localhost",
      port: 5173,
      strictPort: true,
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
    },
  };
});
