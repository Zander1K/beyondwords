// "Test this App" opens this: a username and the access password. A native <dialog>, so focus is
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

/** A pause before the answer: it feels deliberate, and slows down guessing a little. */
const CHECK_MS = 450;

export function AccessDialog({ open, onClose, onSuccess }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const usernameInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const signIn = useAccess((s) => s.signIn);
  const ids = useId();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [attempt, setAttempt] = useState(0);
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
    setPassword("");
    setShow(false);
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
    const result = signIn(username, password);
    setBusy(false);
    if (result.ok) {
      onSuccess(result.username);
      return;
    }
    setProblem(result);
    setAttempt((n) => n + 1);
    // Back to the field that needs fixing, with a wrong password selected for retyping.
    const field = result.field === "username" ? usernameInput.current : passwordInput.current;
    field?.focus();
    if (result.field === "password") field?.select();
  }

  const usernameProblem = problem?.field === "username" ? problem.message : null;
  const passwordProblem = problem?.field === "password" ? problem.message : null;

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

        <p className={styles.eyebrow}>Invite-only demo</p>
        <h2 id={`${ids}-title`} className={styles.title}>
          Test Beyond Words
        </h2>
        <p id={`${ids}-lede`} className={styles.lede}>
          Enter a username and the access password to continue.
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

          <div className={styles.field}>
            <label htmlFor={`${ids}-pass`}>Password</label>
            <div
              className={styles.passwordRow}
              key={`shake-${attempt}`}
              data-shake={passwordProblem ? "true" : undefined}
            >
              <input
                ref={passwordInput}
                id={`${ids}-pass`}
                name="password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                autoCapitalize="none"
                spellCheck={false}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={passwordProblem ? true : undefined}
                aria-describedby={passwordProblem ? `${ids}-pass-error` : undefined}
                required
              />
              <button
                type="button"
                className={styles.reveal}
                onClick={() => setShow((s) => !s)}
                aria-pressed={show}
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? "Hide" : "Show"}
              </button>
            </div>
            {passwordProblem && (
              <p id={`${ids}-pass-error`} className={styles.error} role="alert">
                {passwordProblem}
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
