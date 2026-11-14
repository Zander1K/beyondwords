// Glasses camera preview: what the glasses' point-of-view camera sees. The stream comes from
// GlassesAdapter.startCamera(), never from navigator.mediaDevices directly.
import { useEffect, useRef } from "react";

import type { GlassesErrorCode } from "@/glasses";

import styles from "./CameraPanel.module.css";
import type { CameraStatus } from "./useReaderController";

const MESSAGES: Record<GlassesErrorCode, string> = {
  "permission-denied":
    "Camera access is blocked. Allow the camera for this site (the camera icon in the address bar), then try again.",
  "no-device": "No camera was found, or another app is using it. Close that app and try again.",
  "insecure-context":
    "The camera only works on localhost or over HTTPS. See apps/web/README.md for testing on a phone.",
  unsupported: "This browser cannot use the camera. Try a recent Chrome, Edge, Firefox or Safari.",
  "camera-off": "Start the camera first.",
  "session-inactive": "Start the glasses session first.",
  "not-implemented": "The camera is not available on these glasses yet.",
  unknown: "The camera could not start. Try again.",
};

interface Props {
  camera: CameraStatus;
  capture: { url: string; at: number } | null;
  onStart: () => void;
  onStop: () => void;
  onCapture: () => void;
}

export function CameraPanel(props: Props) {
  const { camera, capture } = props;
  const cameraOn = camera.kind === "on";
  const videoRef = useRef<HTMLVideoElement>(null);
  const stream = camera.kind === "on" ? camera.stream : null;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  return (
    <div className={styles.camera}>
      <div className={styles.status}>
        {cameraOn ? (
          <span className={styles.on} role="status">
            <span className={styles.dot} aria-hidden="true" /> Camera on
          </span>
        ) : (
          <span className={styles.off}>Camera off</span>
        )}
        {cameraOn ? (
          <>
            <button type="button" onClick={props.onCapture}>
              Capture page
            </button>
            <button type="button" onClick={props.onStop}>
              Stop camera
            </button>
          </>
        ) : (
          <button type="button" onClick={props.onStart} disabled={camera.kind === "starting"}>
            {camera.kind === "starting" ? "Starting…" : "Start camera"}
          </button>
        )}
      </div>

      {camera.kind === "error" && (
        <p className={styles.error} role="alert">
          {MESSAGES[camera.code]}
        </p>
      )}

      {stream && (
        <div className={styles.pov}>
          <video
            ref={videoRef}
            className={styles.video}
            autoPlay
            playsInline
            muted
            aria-label="Glasses camera preview"
          />
          <span className={styles.povLabel}>Glasses camera (point of view)</span>
        </div>
      )}

      {capture && (
        <figure className={styles.capture}>
          <img src={capture.url} alt="Last captured page" />
          <figcaption>
            Last capture, {new Date(capture.at).toLocaleTimeString()}. Kept in memory only, never
            saved or uploaded.
          </figcaption>
        </figure>
      )}
    </div>
  );
}
