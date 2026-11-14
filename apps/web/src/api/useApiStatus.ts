// Is the API reachable? Polls GET /health (through the dev proxy at /api) so the app can show
// whether it is talking to the real backend. Never throws: an unreachable API is just a status.
import { useEffect, useState } from "react";

import { getHealth } from "./client";

export type ApiStatus =
  | { state: "checking" }
  | { state: "online"; database: "ok" | "unavailable" }
  | { state: "offline" };

const POLL_MS = 15_000;

export function useApiStatus(): ApiStatus {
  const [status, setStatus] = useState<ApiStatus>({ state: "checking" });
  useEffect(() => {
    const controller = new AbortController();
    const check = () => {
      getHealth(controller.signal)
        .then((h) => setStatus({ state: "online", database: h.database }))
        .catch(() => {
          if (!controller.signal.aborted) setStatus({ state: "offline" });
        });
    };
    check();
    const timer = window.setInterval(check, POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);
  return status;
}
