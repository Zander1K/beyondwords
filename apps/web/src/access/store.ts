// Who is signed in. Kept in localStorage (this browser) and read back on load, so readers stay signed in.
import { create } from "zustand";

import { loginUser, type Profile, setApiUser } from "@/api";

import { checkUsername, parseSession, SESSION_KEY } from "./access";

/** How long to wait before each new try at loading the profile, after the server did not answer. */
const PROFILE_RETRY_MS = [2000, 5000, 10_000, 20_000, 30_000] as const;

/** The part of `Storage` used here, so tests can pass a fake. */
export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SignInResult =
  { ok: true; username: string } | { ok: false; field: "username"; message: string };

/** Tells the server who signed in (POST /users/login); resolves to the reader's profile. */
export type RegisterUser = (username: string) => Promise<Profile>;

export interface AccessState {
  /** The signed-in username, or null. */
  user: string | null;
  /** The reader's id on the server. Null until it answers (or when the API is unreachable). */
  userId: number | null;
  /**
   * The reader's profile from the server (support level, comfort settings, whether they have done
   * first-run setup). Null until the server answers, or when it cannot be reached.
   */
  profile: Profile | null;
  /** They chose "Skip for now" on the welcome screen: do not send them back this session. */
  onboardingSkipped: boolean;
  setProfile: (profile: Profile) => void;
  skipOnboarding: () => void;
  signIn: (username: string) => SignInResult;
  signOut: () => void;
}

/** The browser's localStorage, or nothing when it is unavailable (private mode, tests). */
function browserStorage(): SessionStorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * @param storage where a sign-in is kept (a fake in tests).
 * @param register called after a sign-in to find or create the reader on the server. If it fails
 *   (API or database down) they are still signed in: the demo never blocks on the backend.
 */
export function createAccessStore(
  storage: SessionStorageLike | null = browserStorage(),
  register?: RegisterUser,
) {
  const read = () => {
    try {
      return parseSession(storage?.getItem(SESSION_KEY) ?? null);
    } catch {
      return null;
    }
  };
  const saved = read();
  // The server may not be up yet when someone signs in (it is started separately): keep asking
  // for their profile, a little less often each time, for as long as they stay signed in as them.
  function loadProfile(username: string, attempt = 0): void {
    if (!register) return;
    void register(username)
      .then((profile) => {
        // Only if the same person is still signed in when the server answers.
        if (store.getState().user === username) store.getState().setProfile(profile);
      })
      .catch(() => {
        const wait = PROFILE_RETRY_MS[attempt];
        if (wait === undefined) return;
        setTimeout(() => {
          const now = store.getState();
          if (now.user === username && !now.profile) loadProfile(username, attempt + 1);
        }, wait);
      });
  }

  const remember = (username: string, userId: number) => {
    try {
      storage?.setItem(SESSION_KEY, JSON.stringify({ username, at: Date.now(), userId }));
    } catch {
      // Not remembered across a reload; the id is still held for this page.
    }
  };
  const store = create<AccessState>((set, get) => ({
    user: saved?.username ?? null,
    userId: saved?.userId ?? null,
    profile: null,
    onboardingSkipped: false,
    setProfile: (profile) => {
      set({ profile, userId: profile.id });
      setApiUser(profile.id);
      const user = get().user;
      if (user) remember(user, profile.id);
    },
    skipOnboarding: () => set({ onboardingSkipped: true }),
    signIn: (username) => {
      const name = checkUsername(username);
      if (!name.ok) return { ok: false, field: "username", message: name.message };
      try {
        storage?.setItem(SESSION_KEY, JSON.stringify({ username: name.value, at: Date.now() }));
      } catch {
        // Storage refused (full, blocked): they are still signed in for this page load.
      }
      set({ user: name.value, userId: null, profile: null, onboardingSkipped: false });
      loadProfile(name.value);
      return { ok: true, username: name.value };
    },
    signOut: () => {
      try {
        storage?.removeItem(SESSION_KEY);
      } catch {
        // Nothing stored that could be removed.
      }
      setApiUser(null);
      set({ user: null, userId: null, profile: null, onboardingSkipped: false });
    },
  }));
  // A reload while signed in: ask the server for the profile again.
  if (saved && register) loadProfile(saved.username);
  return store;
}

/** The app's one access store. */
export const useAccess = createAccessStore(undefined, loginUser);
