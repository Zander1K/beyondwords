// The glasses camera as the app's eyes (SIM-CAM-01, 03). Frames come only from
// GlassesAdapter.startCamera(); the page is read continuously from the live view (useLiveScan).
import { useCallback, useEffect, useState } from "react";

import { GlassesError, type GlassesErrorCode, useGlasses } from "@/glasses";

export type CameraStatus =
  | { kind: "off" }
  | { kind: "starting" }
  | { kind: "on"; stream: MediaStream }
  | { kind: "error"; code: GlassesErrorCode };

function errorCode(error: unknown): GlassesErrorCode {
  return error instanceof GlassesError ? error.code : "unknown";
}

export function useCamera() {
  const glasses = useGlasses();
  const [camera, setCamera] = useState<CameraStatus>({ kind: "off" });

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

  // Stop the camera when leaving the screen.
  useEffect(
    () => () => {
      if (stream) for (const t of stream.getTracks()) t.stop();
    },
    [stream],
  );

  return { camera, stream, start, stop };
}
