// Typed API client for the FastAPI backend.
//
// The mobile app had no client to port (its src/api was an empty placeholder) and
// packages/contracts/ts is not generated yet (`make contracts` is build order step 2).
// HACK: response types are hand-mirrored from apps/api/app/schemas until then.
// TODO(alex): import types from packages/contracts/ts once `make contracts` generates them.
import { API_BASE_URL } from "@/config";
import type { Page } from "@/reader";

import type { WordCard } from "@/glasses";

import { type AnalyzeLine, mockAnalyzePage, mockDefineWord } from "./mock";

/** Mirrors apps/api/app/schemas/health.py:HealthResponse. */
export interface HealthResponse {
  status: "ok";
  app: string;
  database: "ok" | "unavailable";
}

/** Mirrors apps/api/app/schemas/ask.py:AskRequest (the fields the web app sends). */
export interface AskRequest {
  question: string;
  session_id?: string | null;
  book_id?: number | null;
  page_lines?: { id: string; text: string }[];
  current_line_id?: string | null;
  pointed_word?: string | null;
}

/** Mirrors apps/api/app/schemas/ask.py:AskResponse. */
export interface AskResponse {
  session_id: string;
  answer: string;
  cited_lines: string[];
  image_url: string | null;
  used_brain: boolean;
  tool_steps: string[];
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

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    throw new ApiError(
      response.status,
      `POST ${path} failed with ${response.status}`,
      response.headers.get("X-Request-ID"),
    );
  }
  return (await response.json()) as T;
}

/** A question about the page (real call: POST /ask, answered by the brain). */
export function askQuestion(body: AskRequest, signal?: AbortSignal): Promise<AskResponse> {
  return postJson<AskResponse>("/ask", body, signal);
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return getJson<HealthResponse>("/health", signal);
}

/**
 * Page analysis: OCR lines -> page JSON (reading order, phrases, hard words).
 * MOCK: TODO(alex, with Matthew) replace with the real POST /pages/analyze (with the still
 * image) once it exists. The mock never leaves the browser.
 */
export async function analyzePage(lines: AnalyzeLine[]): Promise<Page> {
  return mockAnalyzePage(lines);
}

/**
 * Word help: a short definition for the word under the finger.
 * MOCK: TODO(alex, with Matthew) replace with the real POST /words/define (with the sentence
 * as context). Synchronous for now so the card opens instantly.
 */
export function defineWord(word: string): WordCard {
  return mockDefineWord(word);
}
