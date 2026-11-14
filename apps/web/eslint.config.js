import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

// Browser camera and audio APIs. Only src/glasses/web-simulator/ may use them; everything else
// goes through GlassesAdapter so a real MetaDatAdapter can replace the simulator later.
const BROWSER_MEDIA_GLOBALS = [
  "AudioContext",
  "AudioWorkletNode",
  "MediaRecorder",
  "OfflineAudioContext",
  "SpeechSynthesisUtterance",
  "speechSynthesis",
  "SpeechRecognition",
  "webkitSpeechRecognition",
].map((name) => ({
  name,
  message: "Browser audio/camera APIs are only allowed in src/glasses/web-simulator/.",
}));

const BROWSER_MEDIA_PROPERTIES = [
  { object: "navigator", property: "mediaDevices" },
  { object: "window", property: "speechSynthesis" },
  { object: "window", property: "AudioContext" },
  { object: "window", property: "SpeechRecognition" },
  { object: "window", property: "webkitSpeechRecognition" },
].map((rule) => ({
  ...rule,
  message: "Browser audio/camera APIs are only allowed in src/glasses/web-simulator/.",
}));

export default defineConfig([
  globalIgnores(["dist", "coverage", "node_modules"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: { globals: globals.browser },
    rules: {
      // `_name` marks a parameter that is intentionally unused (e.g. the MetaDatAdapter stub).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // CLAUDE.md section 11: no `any` in the API client or the glasses layer.
    files: ["src/api/**/*.{ts,tsx}", "src/glasses/**/*.{ts,tsx}"],
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/glasses/web-simulator/**"],
    rules: {
      "no-restricted-globals": ["error", ...BROWSER_MEDIA_GLOBALS],
      "no-restricted-properties": ["error", ...BROWSER_MEDIA_PROPERTIES],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    // Tests may simulate key presses; the web simulator owns the real key listener.
    ignores: ["src/glasses/web-simulator/**", "src/**/*.test.ts"],
    rules: {
      // SIM-GST-03: gestures reach the app only through GlassesAdapter.onGesture. Raw key
      // listeners live in the web simulator. Form fields keep their normal keyboard behaviour.
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/^key(down|up|press)$/]",
          message: "Listen for glasses gestures with GlassesAdapter.onGesture, not raw key events.",
        },
        {
          selector: "JSXAttribute[name.name=/^onKey(Down|Up|Press)$/]",
          message: "Listen for glasses gestures with GlassesAdapter.onGesture, not raw key events.",
        },
      ],
    },
  },
  prettierConfig,
]);
