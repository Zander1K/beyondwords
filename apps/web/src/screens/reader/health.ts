// What is going on, and what is wrong: the reader's health as status pills (always visible, one
// per part: camera, glasses, page, hands) and issues (a message where the problem is, with what
// to do about it). Pure functions of the app's state so the wording and the rules are tested
// without a browser.
import type { SessionState } from "@/glasses";
import type { ScanState } from "@/state";

import type { CameraStatus } from "./useCamera";
import type { TrackingStats } from "./useHandTracking";

export interface ReaderHealth {
  camera: CameraStatus;
  session: SessionState;
  asleep: boolean;
  /** Glasses link lost. */
  offline: boolean;
  scan: ScanState;
  tracking: TrackingStats;
  handLost: boolean;
}

/** ok = working, busy = loading, warn = check this, error = failed, off = not in use. */
export type PillTone = "ok" | "busy" | "warn" | "error" | "off";

export interface StatusPill {
  id: "camera" | "glasses" | "page" | "hands";
  label: string;
  tone: PillTone;
  /** Extra detail for the tooltip (rates and timings). */
  detail?: string;
}

export function derivePills(h: ReaderHealth): StatusPill[] {
  const pills: StatusPill[] = [];
  const camOn = h.camera.kind === "on";

  switch (h.camera.kind) {
    case "on":
      pills.push({ id: "camera", label: "Camera on", tone: "ok" });
      break;
    case "starting":
      pills.push({ id: "camera", label: "Starting camera", tone: "busy" });
      break;
    case "error":
      pills.push({ id: "camera", label: "Camera unavailable", tone: "error" });
      break;
    case "off":
      pills.push({ id: "camera", label: "Camera off", tone: "off" });
      break;
  }

  if (h.offline) {
    pills.push({ id: "glasses", label: "Glasses offline", tone: "error" });
  } else if (h.session === "started") {
    pills.push(
      h.asleep
        ? { id: "glasses", label: "Display asleep", tone: "warn" }
        : { id: "glasses", label: "Reading", tone: "ok" },
    );
  } else if (h.session === "starting" || h.session === "stopping") {
    pills.push({
      id: "glasses",
      label: h.session === "starting" ? "Starting glasses" : "Stopping glasses",
      tone: "busy",
    });
  } else {
    pills.push({ id: "glasses", label: "Glasses off", tone: "off" });
  }

  if (!camOn) {
    pills.push({ id: "page", label: "Demo page", tone: "off" });
    return pills;
  }

  switch (h.scan.status) {
    case "idle":
    case "scanning":
      pills.push({
        id: "page",
        label: "Loading text reader",
        tone: "busy",
        detail: "The first run downloads the text model.",
      });
      break;
    case "live":
      pills.push({
        id: "page",
        label: `${h.scan.lines} ${h.scan.lines === 1 ? "line" : "lines"}`,
        tone: "ok",
        detail: `${h.scan.ocrMs} ms per read${h.scan.reused ? ` · ${h.scan.reused} lines kept` : ""}`,
      });
      break;
    case "empty":
      pills.push({ id: "page", label: "No text in view", tone: "warn" });
      break;
    case "error":
      pills.push({ id: "page", label: "Reader failed", tone: "error" });
      break;
  }

  const t = h.tracking;
  if (t.status === "error") {
    pills.push({ id: "hands", label: "Hands unavailable", tone: "error" });
  } else if (t.status === "running") {
    pills.push(
      h.handLost
        ? { id: "hands", label: "Hand lost", tone: "warn", detail: "Holding the last line." }
        : {
            id: "hands",
            label: t.fingerOnly ? "Finger only" : "Hands",
            tone: "ok",
            detail: `${t.fps} fps · ${t.detectMs} ms`,
          },
    );
  } else {
    pills.push({ id: "hands", label: "Loading hands", tone: "busy" });
  }
  return pills;
}

export type IssueSeverity = "info" | "warn" | "error";

export interface Issue {
  id: string;
  severity: IssueSeverity;
  title: string;
  detail?: string;
  /** Still trying (loading or retrying): shown with the busy ring. */
  busy?: boolean;
  /** The person can close it (a one-off notice, not a state that persists). */
  dismissible?: boolean;
  /** The underlying error text, shown small, so a failure can be diagnosed. */
  cause?: string;
  action?: { id: "retry-hands"; label: string };
}

/**
 * The problems to show on the camera view, worst first. Brief states (a lost hand) are not
 * issues: the status pills and the glasses display already say so, and a message that appears
 * every time the hand drops would only distract.
 */
export function deriveIssues(h: ReaderHealth): Issue[] {
  if (h.camera.kind !== "on") return []; // the camera view explains a missing camera itself
  const issues: Issue[] = [];

  if (h.tracking.status === "error") {
    issues.push({
      id: "hands-failed",
      severity: "error",
      title: "Hand tracking didn't load",
      detail: "Pointing is off. Use the arrow keys or the pad in Controls, or try again.",
      action: { id: "retry-hands", label: "Try again" },
    });
  }

  switch (h.scan.status) {
    case "error":
      issues.push({
        id: "reader-failed",
        severity: "error",
        title: "Couldn't read the page",
        detail:
          "The text reader failed to load or run. Check your connection: the model downloads once. Retrying…",
        busy: true,
        cause: h.scan.cause,
      });
      break;
    case "empty":
      issues.push({
        id: "no-text",
        severity: "warn",
        title: "No text in view",
        detail: "Aim the camera at the page so it fills most of the frame.",
      });
      break;
    case "idle":
    case "scanning":
      issues.push({
        id: "reader-loading",
        severity: "info",
        title: "Starting the text reader",
        detail: "The first run downloads the text model (about 30 MB).",
        busy: true,
      });
      break;
    case "live":
      break;
  }
  return issues;
}
