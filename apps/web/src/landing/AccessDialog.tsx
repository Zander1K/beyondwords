// "Test this App" opens this: a username. A native <dialog>, so focus is
// trapped, Escape closes it and the page behind is inert without any code of ours. On success it
// hands the username back; the page then takes them into the app.
import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import { type SignInResult, useAccess } from "@/access";

import { Button } from "./Button";
import styles from "./AccessDialog.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (username: string) => void;
}

type Problem = Extract<SignInResult, { ok: false }>;

/** A short pause before the answer, so the button press feels acknowledged. */
const CHECK_MS = 450;

export function AccessDialog({ open, onClose, onSuccess }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const usernameInput = useRef<HTMLInputElement>(null);
  const signIn = useAccess((s) => s.signIn);
  const ids = useId();
  const [username, setUsername] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);

  // Open and close the dialog with `open`; start in the username field.
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      usernameInput.current?.focus();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  // Whenever the dialog closes (the X, Escape, the backdrop or a successful sign-in), forget what
  // was typed so the next opening starts clean.
  function handleClose() {
    setProblem(null);
    setBusy(false);
    onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    await new Promise((resolve) => setTimeout(resolve, CHECK_MS));
    const result = signIn(username);
    setBusy(false);
    if (result.ok) {
      onSuccess(result.username);
      return;
    }
    setProblem(result);
    usernameInput.current?.focus();
  }

  const usernameProblem = problem?.field === "username" ? problem.message : null;

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={`${ids}-title`}
      aria-describedby={`${ids}-lede`}
      onClose={handleClose}
      // A click on the backdrop (the dialog itself, outside its card) closes it.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.card}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>

        <p className={styles.eyebrow}>Open demo</p>
        <h2 id={`${ids}-title`} className={styles.title}>
          Test Beyond Words
        </h2>
        <p id={`${ids}-lede`} className={styles.lede}>
          Any username works, with no password. Choose 3 to 32 letters, numbers, dots, dashes or
          underscores. A new username starts a new reader; the same one picks up where you left off,
          and this browser keeps you signed in.
        </p>

        <form className={styles.form} onSubmit={submit} noValidate>
          <div className={styles.field}>
            <label htmlFor={`${ids}-user`}>Username</label>
            <input
              ref={usernameInput}
              id={`${ids}-user`}
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={40}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-invalid={usernameProblem ? true : undefined}
              aria-describedby={usernameProblem ? `${ids}-user-error` : undefined}
              required
            />
            {usernameProblem && (
              <p id={`${ids}-user-error`} className={styles.error} role="alert">
                {usernameProblem}
              </p>
            )}
          </div>

          <Button
            type="submit"
            variant="blue"
            size="lg"
            label={busy ? "Checking…" : "Continue"}
            arrow={!busy}
            disabled={busy}
          />
        </form>
      </div>
    </dialog>
  );
}
