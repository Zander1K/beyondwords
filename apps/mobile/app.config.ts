import type { ExpoConfig } from "expo/config";

// Single source for the app name (CLAUDE.md: rename in one place). Read from env, same
// variable the API uses; falls back to the working name.
const APP_NAME = process.env.APP_NAME ?? "Reading Companion";

const config: ExpoConfig = {
  name: APP_NAME,
  slug: "reading-companion",
  scheme: "readingcompanion",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  ios: {
    supportsTablet: true,
    // TODO(Alex): bundleIdentifier, required for DAT dev builds. OPEN QUESTION: final id.
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    // TODO(Alex): package name, required for DAT dev builds. OPEN QUESTION: final id.
  },
  web: {
    favicon: "./assets/favicon.png",
  },
  plugins: ["expo-router"],
  extra: {
    appName: APP_NAME,
  },
};

export default config;
