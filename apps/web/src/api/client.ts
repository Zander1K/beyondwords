// Typed API client for the FastAPI backend.
//
// The mobile app had no client to port (its src/api was an empty placeholder) and
// packages/contracts/ts is not generated yet (`make contracts` is build order step 2).
// HACK: response types are hand-mirrored from apps/api/app/schemas until then.
// TODO(alex): import types from packages/contracts/ts once `make contracts` generates them.
import { API_BASE_URL } from "@/config";

/** Mirrors apps/api/app/schemas/health.py:HealthResponse. */
export interface HealthResponse {
  status: "ok";
  app: string;
  database: "ok" | "unavailable";
}

export class ApiError extends Error {
  readonly status: number;
  readonly requestId: string | null;

  constructor(status: number, message: string, requestId: string | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.requestId = requestId;
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    // The API puts a request id on every response (CLAUDE.md section 9) so failures can be traced.
    throw new ApiError(
      response.status,
      `GET ${path} failed with ${response.status}`,
      response.headers.get("X-Request-ID"),
    );
  }
  return (await response.json()) as T;
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return getJson<HealthResponse>("/health", signal);
}
