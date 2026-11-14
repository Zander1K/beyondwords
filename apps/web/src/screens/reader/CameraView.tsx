// The live camera view (SIM-CAM-01, 03): what the glasses camera sees, filling the reader view.
// The video sits in a box with the camera's aspect ratio, centred, so the vision overlays
// (children) line up with the image at any screen size. The stream comes from
// GlassesAdapter.startCamera(), never from navigator.mediaDevices directly.
import { type CSSProperties, type ReactNode, type RefObject, useEffect, useState } from "react";

import type { GlassesErrorCode } from "@/glasses";

import styles from "./CameraView.module.css";
import type { CameraStatus } from "./useCamera";

const MESSAGES: Record<GlassesErrorCode, string> = {
  "permission-denied":
    "Camera access is blocked. Allow the camera for this site (the camera icon in the address bar), then retry.",
  "no-device": "No camera found, it was unplugged, or another app is using it.",
  "insecure-context":
    "The camera only works on localhost or over HTTPS. On a phone, use `make web-lan` (see apps/web/README.md).",
  unsupported: "This browser cannot use the camera. Try a recent Chrome, Edge, Firefox or Safari.",
  "camera-off": "The camera is off.",
  "session-inactive": "Start the glasses session first.",
  "not-implemented": "The camera is not available on these glasses yet.",
  unknown: "The camera could not start.",
};

interface Props {
  camera: CameraStatus;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Vision overlays drawn over the image (fingertip, line and word boxes). */
  children?: ReactNode;
  onStart: () => void;
}

/** 4:3 until the camera reports its real size. */
const DEFAULT_RATIO = 4 / 3;

export function CameraView({ camera, videoRef, children, onStart }: Props) {
  const stream = camera.kind === "on" ? camera.stream : null;
  const live = stream !== null;
  const [ratio, setRatio] = useState(DEFAULT_RATIO);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
    return () => {
      video.srcObject = null;
    };
  }, [stream, videoRef]);

  const onVideoSize = () => {
    const v = videoRef.current;
    if (v?.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight);
  };

  const media: CSSProperties = { ["--ar" as string]: String(ratio) };

  return (
    <div className={styles.view}>
      <div className={styles.media} style={media} hidden={!live}>
        {/* The video stays mounted so vision can read frames from it. */}
        <video
          ref={videoRef}
          className={styles.fill}
          autoPlay
          playsInline
          muted
          onLoadedMetadata={onVideoSize}
          onResize={onVideoSize}
          aria-label="Glasses camera view"
        />
        <div className={styles.overlay}>{children}</div>
      </div>

      {!live && (
        <div className={styles.placeholder}>
          {camera.kind === "error" ? (
            <p role="alert">{MESSAGES[camera.code]}</p>
          ) : (
            <p>
              The camera is the glasses’ eyes. Aim it down at the open book from reading distance so
              the page fills most of the frame; the page is read live as you point.
            </p>
          )}
          <div className={styles.buttons}>
            <button type="button" onClick={onStart} disabled={camera.kind === "starting"}>
              {camera.kind === "starting"
                ? "Starting…"
                : camera.kind === "error"
                  ? "Retry camera"
                  : "Start camera"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
