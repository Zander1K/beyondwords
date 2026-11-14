// Who is signed in. Kept in sessionStorage (this tab only) and read back on load.
import { create } from "zustand";

import {
  ACCESS_PASSWORD_SHA256,
  checkPassword,
  checkUsername,
  parseSession,
  SESSION_KEY,
} from "./access";

/** The part of `Storage` used here, so tests can pass a fake. */
export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SignInResult =
  { ok: true; username: string } | { ok: false; field: "username" | "password"; message: string };

export interface AccessState {
  /** The signed-in username, or null. */
  user: string | null;
  signIn: (username: string, password: string) => SignInResult;
  signOut: () => void;
}

/** The browser's sessionStorage, or nothing when it is unavailable (private mode, tests). */
function browserStorage(): SessionStorageLike | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * @param storage where a sign-in is kept (a fake in tests).
 * @param passwordDigest SHA-256 of the password to accept (a test password of their own in tests).
 */
export function createAccessStore(
  storage: SessionStorageLike | null = browserStorage(),
  passwordDigest: string = ACCESS_PASSWORD_SHA256,
) {
  const read = () => {
    try {
      return parseSession(storage?.getItem(SESSION_KEY) ?? null)?.username ?? null;
    } catch {
      return null;
    }
  };
  return create<AccessState>((set) => ({
    user: read(),
    signIn: (username, password) => {
      const name = checkUsername(username);
      if (!name.ok) return { ok: false, field: "username", message: name.message };
      if (!checkPassword(password, passwordDigest)) {
        return { ok: false, field: "password", message: "That password isn't right. Try again." };
      }
      try {
        storage?.setItem(SESSION_KEY, JSON.stringify({ username: name.value, at: Date.now() }));
      } catch {
        // Storage refused (full, blocked): they are still signed in for this page load.
      }
      set({ user: name.value });
      return { ok: true, username: name.value };
    },
    signOut: () => {
      try {
        storage?.removeItem(SESSION_KEY);
      } catch {
        // Nothing stored that could be removed.
      }
      set({ user: null });
    },
  }));
}

/** The app's one access store. */
export const useAccess = createAccessStore();
