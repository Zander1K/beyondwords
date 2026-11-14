// The glasses camera as the app's eyes (SIM-CAM-01..03). Frames come only from
// GlassesAdapter.startCamera(); page stills from captureStill() or an uploaded photo.
import { useCallback, useEffect, useState } from "react";

import { GlassesError, type GlassesErrorCode, useGlasses } from "@/glasses";

export type CameraStatus =
  | { kind: "off" }
  | { kind: "starting" }
  | { kind: "on"; stream: MediaStream }
  | { kind: "error"; code: GlassesErrorCode };

/** A page image for analysis: a camera still or an uploaded photo. In memory only. */
export interface PageImage {
  blob: Blob;
  url: string;
  source: "camera" | "upload";
  at: number;
}

function errorCode(error: unknown): GlassesErrorCode {
  return error instanceof GlassesError ? error.code : "unknown";
}

export function useCamera() {
  const glasses = useGlasses();
  const [camera, setCamera] = useState<CameraStatus>({ kind: "off" });
  const [still, setStill] = useState<PageImage | null>(null);
  const [flashAt, setFlashAt] = useState<number | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const stream = camera.kind === "on" ? camera.stream : null;

  const start = useCallback(async () => {
    setCamera({ kind: "starting" });
    try {
      setCamera({ kind: "on", stream: await glasses.startCamera() });
    } catch (error) {
      setCamera({ kind: "error", code: errorCode(error) });
    }
  }, [glasses]);

  const stop = useCallback(() => {
    setCamera((c) => {
      if (c.kind === "on") for (const t of c.stream.getTracks()) t.stop();
      return { kind: "off" };
    });
  }, []);

  /** SIM-CAM-02: a high-quality still for page analysis, with a capture flash. */
  const capture = useCallback(async (): Promise<PageImage | null> => {
    try {
      const blob = await glasses.captureStill();
      const image: PageImage = {
        blob,
        url: URL.createObjectURL(blob),
        source: "camera",
        at: Date.now(),
      };
      setStill(image);
      setFlashAt(image.at);
      setCaptureError(null);
      return image;
    } catch (error) {
      glasses.playCue("error");
      setCaptureError(error instanceof Error ? error.message : "The page photo failed.");
      return null;
    }
  }, [glasses]);

  /** SIM-CAM-03 fallback: an uploaded page photo feeds the same pipeline. */
  const upload = useCallback((file: File): PageImage => {
    const image: PageImage = {
      blob: file,
      url: URL.createObjectURL(file),
      source: "upload",
      at: Date.now(),
    };
    setStill(image);
    return image;
  }, []);

  // The camera can end on its own (unplugged, permission revoked).
  useEffect(() => {
    if (!stream) return;
    const tracks = stream.getVideoTracks();
    const onEnded = () => setCamera({ kind: "error", code: "no-device" });
    for (const t of tracks) t.addEventListener("ended", onEnded);
    return () => {
      for (const t of tracks) t.removeEventListener("ended", onEnded);
    };
  }, [stream]);

  // Free the previous image; stop the camera when leaving the screen.
  useEffect(() => () => (still ? URL.revokeObjectURL(still.url) : undefined), [still]);
  useEffect(
    () => () => {
      if (stream) for (const t of stream.getTracks()) t.stop();
    },
    [stream],
  );

  return { camera, stream, still, flashAt, captureError, start, stop, capture, upload };
}
