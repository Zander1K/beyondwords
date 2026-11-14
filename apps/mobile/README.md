# mobile

React Native + Expo (SDK 58) app with Expo Router, strict TypeScript, ESLint + Prettier. Owner: Alex.

```sh
pnpm install        # from the repo root (pnpm workspace)
pnpm start          # Expo dev server; open in Expo Go or a dev build
pnpm lint           # eslint + prettier --check + tsc
pnpm test           # jest (jest-expo)
```

- Routes live in `src/app/` (Expo Router). Other modules: `glasses/`, `vision/`, `reader/`,
  `live/`, `api/`, `state/`, `ui/`. All are placeholders right now.
- App name comes from `APP_NAME` (env) in `app.config.ts`.
- The Meta DAT wrapper is **not installed yet** (build order step 5). It needs native code, so
  once added the app needs a development build (`npx expo run:ios`); Expo Go will not work.
- Read `AGENTS.md` before touching Expo APIs: SDK APIs change between releases.
