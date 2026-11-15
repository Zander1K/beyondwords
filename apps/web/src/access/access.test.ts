import { describe, expect, it, vi } from "vitest";

import type { Profile } from "@/api";

import { checkUsername, normaliseUsername, parseSession, SESSION_KEY } from "./access";
import { createAccessStore, type SessionStorageLike } from "./store";

describe("usernames", () => {
  it("tidies spaces and control characters", () => {
    expect(normaliseUsername("  Ada   Lovelace \n")).toBe("Ada Lovelace");
    expect(normaliseUsername("a\u0000b\u001fc")).toBe("abc");
  });

  it("accepts names the API accepts, folding capitals to lower case", () => {
    for (const [typed, stored] of [
      ["ada", "ada"],
      ["Ada_L", "ada_l"],
      ["  J.Doe-2 ", "j.doe-2"],
      ["x77", "x77"],
    ] as const) {
      expect(checkUsername(typed)).toEqual({ ok: true, value: stored });
    }
  });

  it("asks for one when it is missing or too short, and says how long it can be", () => {
    for (const bad of ["", "   ", "a", "ab", " b "]) {
      const r = checkUsername(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/username/i);
    }
    const long = checkUsername("a".repeat(33));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.message).toMatch(/32/);
  });

  it("refuses what the API refuses: spaces, markup, symbols, other alphabets", () => {
    for (const bad of [
      "ada lovelace",
      "<script>",
      "ada<b>",
      "a&b",
      "ada@home",
      "_lead",
      "-dash",
      "ada;drop",
      "李明明",
      "seán",
    ]) {
      expect(checkUsername(bad).ok).toBe(false);
    }
  });
});

describe("parseSession", () => {
  it("reads back what was stored", () => {
    expect(parseSession(JSON.stringify({ username: "Ada", at: 5 }))).toEqual({
      username: "ada",
      at: 5,
    });
  });

  it("returns null for anything that is not a session of ours", () => {
    for (const raw of [
      null,
      "",
      "not json",
      "42",
      "null",
      JSON.stringify({ username: "Ada" }),
      JSON.stringify({ username: 7, at: 1 }),
      JSON.stringify({ username: "<b>", at: 1 }),
      JSON.stringify({ username: "", at: 1 }),
    ]) {
      expect(parseSession(raw)).toBeNull();
    }
  });
});

describe("the access store", () => {
  /** A fake localStorage. */
  function fakeStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    const storage: SessionStorageLike = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
    return { storage, data };
  }

  it("starts signed out", () => {
    expect(createAccessStore(fakeStorage().storage).getState().user).toBeNull();
  });

  it("signs in with just a username, and remembers it in this browser", () => {
    const { storage, data } = fakeStorage();
    const store = createAccessStore(storage);
    const result = store.getState().signIn("  Ada_Lovelace ");
    expect(result).toEqual({ ok: true, username: "ada_lovelace" });
    expect(store.getState().user).toBe("ada_lovelace");
    expect(JSON.parse(data.get(SESSION_KEY) ?? "{}")).toMatchObject({ username: "ada_lovelace" });
    // A reload (a new store on the same storage) is still signed in.
    expect(createAccessStore(storage).getState().user).toBe("ada_lovelace");
  });

  it("lets any valid username in, with no password", () => {
    const store = createAccessStore(fakeStorage().storage);
    for (const name of ["ada", "Someone.Else", "reader_42"]) {
      expect(store.getState().signIn(name)).toMatchObject({ ok: true });
    }
  });

  it("refuses a missing username", () => {
    const store = createAccessStore(fakeStorage().storage);
    expect(store.getState().signIn("")).toMatchObject({
      ok: false,
      field: "username",
    });
    expect(store.getState().user).toBeNull();
  });

  it("signs out, forgetting the session", () => {
    const { storage, data } = fakeStorage();
    const store = createAccessStore(storage);
    store.getState().signIn("ada");
    store.getState().signOut();
    expect(store.getState().user).toBeNull();
    expect(data.size).toBe(0);
    expect(createAccessStore(storage).getState().user).toBeNull();
  });

  it("ignores a stored session that was tampered with", () => {
    const { storage } = fakeStorage({ [SESSION_KEY]: '{"username":"<img onerror=x>","at":1}' });
    expect(createAccessStore(storage).getState().user).toBeNull();
  });

  it("still works when storage is missing or refuses to write", () => {
    const none = createAccessStore(null);
    expect(none.getState().signIn("ada")).toMatchObject({ ok: true });
    expect(none.getState().user).toBe("ada");
    const refusing = createAccessStore({
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(refusing.getState().signIn("ada")).toMatchObject({ ok: true });
    expect(() => refusing.getState().signOut()).not.toThrow();
    expect(refusing.getState().user).toBeNull();
  });

  const profile = (over: Partial<Profile> = {}): Profile => ({
    id: 42,
    username: "ada_l",
    display_name: null,
    support_level: "read_along",
    glasses_type: null,
    voice: null,
    spacing: null,
    onboarded: false,
    ...over,
  });

  it("tells the server who signed in and keeps the profile it answers with", async () => {
    const { storage, data } = fakeStorage();
    const register = vi.fn().mockResolvedValue(profile());
    const store = createAccessStore(storage, register);
    store.getState().signIn("Ada_L");
    expect(register).toHaveBeenCalledWith("ada_l");
    expect(store.getState().profile).toBeNull(); // not known until the server answers
    await vi.waitFor(() => expect(store.getState().userId).toBe(42));
    expect(store.getState().profile?.onboarded).toBe(false);
    expect(JSON.parse(data.get(SESSION_KEY) ?? "{}")).toMatchObject({ userId: 42 });
    expect(createAccessStore(storage).getState().userId).toBe(42);
  });

  it("asks the server for the profile again after a reload", async () => {
    const { storage } = fakeStorage();
    const first = createAccessStore(storage, vi.fn().mockResolvedValue(profile()));
    first.getState().signIn("ada_l");
    await vi.waitFor(() => expect(first.getState().profile).not.toBeNull());
    const register = vi.fn().mockResolvedValue(profile({ onboarded: true }));
    const reloaded = createAccessStore(storage, register);
    expect(register).toHaveBeenCalledWith("ada_l");
    await vi.waitFor(() => expect(reloaded.getState().profile?.onboarded).toBe(true));
  });

  it("remembers a skipped setup for this session only", () => {
    const store = createAccessStore(fakeStorage().storage);
    store.getState().signIn("ada");
    store.getState().skipOnboarding();
    expect(store.getState().onboardingSkipped).toBe(true);
    store.getState().signOut();
    expect(store.getState().onboardingSkipped).toBe(false);
  });

  it("stays signed in when the server cannot be reached", async () => {
    const register = vi.fn().mockRejectedValue(new Error("offline"));
    const store = createAccessStore(fakeStorage().storage, register);
    expect(store.getState().signIn("ada")).toMatchObject({ ok: true });
    await Promise.resolve();
    expect(store.getState().user).toBe("ada");
    expect(store.getState().profile).toBeNull();
  });

  it("ignores a late answer after signing out", async () => {
    let answer: (p: Profile) => void = () => undefined;
    const register = vi.fn().mockReturnValue(new Promise<Profile>((r) => (answer = r)));
    const store = createAccessStore(fakeStorage().storage, register);
    store.getState().signIn("ada");
    store.getState().signOut();
    answer(profile({ id: 7 }));
    await Promise.resolve();
    expect(store.getState().userId).toBeNull();
    expect(store.getState().profile).toBeNull();
  });
});

const memoryStorage = (): SessionStorageLike => {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

describe("loading the profile when the server is not up yet", () => {
  it("keeps trying, and signs the reader in properly once the server answers", async () => {
    vi.useFakeTimers();
    try {
      const reply = (p: Profile) => p;
      const register = vi
        .fn()
        .mockRejectedValueOnce(new Error("down"))
        .mockRejectedValueOnce(new Error("down"))
        .mockImplementation(async () =>
          reply({
            id: 9,
            username: "ada",
            display_name: null,
            support_level: "read_along",
            glasses_type: null,
            voice: null,
            spacing: null,
            onboarded: true,
          }),
        );
      const store = createAccessStore(memoryStorage(), register);
      store.getState().signIn("ada");
      await vi.advanceTimersByTimeAsync(100);
      expect(store.getState().userId).toBeNull(); // the server is not answering yet
      await vi.advanceTimersByTimeAsync(2100); // first retry: still down
      expect(store.getState().userId).toBeNull();
      await vi.advanceTimersByTimeAsync(5100); // second retry: up
      expect(store.getState().userId).toBe(9);
      expect(register).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops trying once they sign out", async () => {
    vi.useFakeTimers();
    try {
      const register = vi.fn().mockRejectedValue(new Error("down"));
      const store = createAccessStore(memoryStorage(), register);
      store.getState().signIn("ada");
      await vi.advanceTimersByTimeAsync(100);
      store.getState().signOut();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(register).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
