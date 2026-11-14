// Glasses camera preview. The stream comes from GlassesAdapter.startCamera() (the browser camera
// in the simulator), never from navigator.mediaDevices directly.
import { useEffect, useRef, useState } from "react";

import { GlassesError, type GlassesErrorCode, useGlasses } from "@/glasses";

import styles from "./CameraPanel.module.css";

type CameraState =
  | { kind: "off" }
  | { kind: "starting" }
  | { kind: "on"; stream: MediaStream }
  | { kind: "error"; code: GlassesErrorCode };

const MESSAGES: Record<GlassesErrorCode, string> = {
  "permission-denied":
    "Camera access is blocked. Allow the camera for this site (the camera icon in the address bar), then try again.",
  "no-device": "No camera was found. Connect a camera and try again.",
  "insecure-context":
    "The camera only works on localhost or over HTTPS. See apps/web/README.md for testing on a phone.",
  unsupported: "This browser cannot use the camera. Try a recent Chrome, Edge, Firefox or Safari.",
  "not-implemented": "The camera is not available on these glasses yet.",
  unknown: "The camera could not start. Try again.",
};

function stopStream(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

export function CameraPanel() {
  const glasses = useGlasses();
  const [camera, setCamera] = useState<CameraState>({ kind: "off" });
  const videoRef = useRef<HTMLVideoElement>(null);
  const stream = camera.kind === "on" ? camera.stream : null;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    return () => {
      video.srcObject = null;
      stopStream(stream);
    };
  }, [stream]);

  const start = async () => {
    setCamera({ kind: "starting" });
    try {
      setCamera({ kind: "on", stream: await glasses.startCamera() });
    } catch (error) {
      setCamera({ kind: "error", code: error instanceof GlassesError ? error.code : "unknown" });
    }
  };

  return (
    <div className={styles.camera}>
      <div className={styles.status}>
        {camera.kind === "on" ? (
          <span className={styles.on} role="status">
            <span className={styles.dot} aria-hidden="true" /> Camera on
          </span>
        ) : (
          <span className={styles.off}>Camera off</span>
        )}
        {camera.kind === "on" ? (
          <button type="button" onClick={() => setCamera({ kind: "off" })}>
            Stop camera
          </button>
        ) : (
          <button type="button" onClick={start} disabled={camera.kind === "starting"}>
            {camera.kind === "starting" ? "Starting…" : "Start camera"}
          </button>
        )}
      </div>

      {camera.kind === "error" && (
        <p className={styles.error} role="alert">
          {MESSAGES[camera.code]}
        </p>
      )}

      {camera.kind === "on" && (
        <video
          ref={videoRef}
          className={styles.video}
          autoPlay
          playsInline
          muted
          aria-label="Glasses camera preview"
        />
      )}
    </div>
  );
}
