// The live camera view: the main stage of the simulation (SIM-CAM-01..03). It shows what the
// glasses camera sees, plus debug overlays (children) drawn by the vision module. The stream
// comes from GlassesAdapter.startCamera(), never from navigator.mediaDevices directly.
import { type ChangeEvent, type ReactNode, type RefObject, useEffect, useRef } from "react";

import type { GlassesErrorCode } from "@/glasses";

import styles from "./CameraStage.module.css";
import type { CameraStatus, PageImage } from "./useCamera";

const MESSAGES: Record<GlassesErrorCode, string> = {
  "permission-denied":
    "Camera access is blocked. Allow the camera for this site (the camera icon in the address bar), then retry.",
  "no-device": "No camera found, it was unplugged, or another app is using it.",
  "insecure-context":
    "The camera only works on localhost or over HTTPS. See apps/web/README.md for testing on a phone.",
  unsupported: "This browser cannot use the camera. Try a recent Chrome, Edge, Firefox or Safari.",
  "camera-off": "The camera is off.",
  "session-inactive": "Start the glasses session first.",
  "not-implemented": "The camera is not available on these glasses yet.",
  unknown: "The camera could not start.",
};

interface Props {
  camera: CameraStatus;
  still: PageImage | null;
  flashAt: number | null;
  captureError: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Readouts for the top bar (FPS, latency, page status). */
  readouts?: ReactNode;
  /** Debug overlays drawn over the camera view (fingertip, line boxes). */
  children?: ReactNode;
  onStart: () => void;
  onStop: () => void;
  onCapture: () => void;
  onUpload: (file: File) => void;
}

export function CameraStage(props: Props) {
  const { camera, still, flashAt, captureError, videoRef } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const stream = camera.kind === "on" ? camera.stream : null;
  const live = stream !== null;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
    return () => {
      video.srcObject = null;
    };
  }, [stream, videoRef]);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) props.onUpload(file);
    e.target.value = "";
  };

  const showUploaded = !live && still?.source === "upload";

  return (
    <div className={styles.stage}>
      <div className={styles.bar}>
        {live ? (
          <span className={styles.on} role="status">
            <span className={styles.dot} aria-hidden="true" /> Camera on
          </span>
        ) : (
          <span className={styles.off}>Camera off</span>
        )}
        {props.readouts}
      </div>

      <div className={styles.view} data-live={live}>
        {/* The video stays mounted so vision can read frames from it. */}
        <video
          ref={videoRef}
          className={styles.video}
          hidden={!live}
          autoPlay
          playsInline
          muted
          aria-label="Glasses camera view"
        />
        {showUploaded && <img className={styles.video} src={still.url} alt="Uploaded page photo" />}
        {(live || showUploaded) && <div className={styles.overlay}>{props.children}</div>}
        {flashAt !== null && <span key={flashAt} className={styles.flash} aria-hidden="true" />}

        {!live && !showUploaded && (
          <div className={styles.placeholder}>
            {camera.kind === "error" ? (
              <>
                <p role="alert">{MESSAGES[camera.code]}</p>
                <div className={styles.buttons}>
                  <button type="button" onClick={props.onStart}>
                    Retry camera
                  </button>
                  <button type="button" onClick={() => fileRef.current?.click()}>
                    Upload a page photo instead
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>
                  The camera is the glasses’ eyes. Aim it down at the open book from reading
                  distance so the page fills most of the frame.
                </p>
                <div className={styles.buttons}>
                  <button
                    type="button"
                    onClick={props.onStart}
                    disabled={camera.kind === "starting"}
                  >
                    {camera.kind === "starting" ? "Starting…" : "Start camera"}
                  </button>
                  <button type="button" onClick={() => fileRef.current?.click()}>
                    Upload a page photo
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {still && (
          <figure className={styles.thumb}>
            <img src={still.url} alt="Last page photo" />
            <figcaption>{still.source === "upload" ? "Uploaded" : "Last still"}</figcaption>
          </figure>
        )}
      </div>

      <div className={styles.buttons}>
        {live && (
          <>
            <button type="button" onClick={props.onCapture}>
              Scan page
            </button>
            <button type="button" onClick={props.onStop}>
              Stop camera
            </button>
          </>
        )}
        {showUploaded && (
          <button type="button" onClick={props.onStart}>
            Use the camera
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={onFile}
          aria-label="Upload a page photo"
        />
      </div>
      {captureError && (
        <p className={styles.error} role="alert">
          {captureError}
        </p>
      )}
      <p className={styles.privacy}>
        Frames and photos stay in this browser tab: nothing is saved or uploaded.
      </p>
    </div>
  );
}
