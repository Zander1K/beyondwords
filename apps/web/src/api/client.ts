// Typed API client for the FastAPI backend.
//
// The mobile app had no client to port (its src/api was an empty placeholder) and
// packages/contracts/ts is not generated yet (`make contracts` is build order step 2).
// HACK: response types are hand-mirrored from apps/api/app/schemas until then.
// TODO(alex): import types from packages/contracts/ts once `make contracts` generates them.
import { API_BASE_URL } from "@/config";
import type { Page } from "@/reader";

import { withBook } from "./context";

import { type AnalyzeLine, mockAnalyzePage } from "./mock";

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

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
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

export async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
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
  return postJson<AskResponse>("/ask", withBook(body), signal);
}

/** Mirrors apps/api/app/schemas/words.py:DefineWordResponse. */
export interface DefineWordResponse {
  word: string;
  syllables: string[];
  say_as: string;
  meaning: string;
  example: string | null;
  illustratable: boolean;
  degraded: boolean;
}

/** A word's meaning in context (real call: POST /words/define). */
export function defineWordRemote(
  body: { word: string; sentence: string; book_id?: number | null },
  signal?: AbortSignal,
): Promise<DefineWordResponse> {
  return postJson<DefineWordResponse>("/words/define", withBook(body), signal);
}

/** Mirrors apps/api/app/schemas/users.py:Spacing. */
export interface ProfileSpacing {
  letter_spacing: number;
  word_spacing: number;
  line_height: number;
  font_size: number;
}

export type SupportLevel = "listen" | "read_along" | "solo";
export type GlassesKind = "display" | "gen2";

/** Mirrors apps/api/app/schemas/users.py:Profile. */
export interface Profile {
  id: number;
  username: string;
  display_name: string | null;
  support_level: SupportLevel;
  glasses_type: GlassesKind | null;
  voice: string | null;
  spacing: ProfileSpacing | null;
  /** False for a reader who has not done first-run setup. */
  onboarded: boolean;
}

/** Mirrors apps/api/app/schemas/users.py:OnboardingRequest. */
export interface OnboardingAnswers {
  support_level: SupportLevel;
  glasses_type: GlassesKind | null;
  display_name: string | null;
  spacing: ProfileSpacing | null;
}

/** Find or create the reader for a username (real call: POST /users/login). */
export async function loginUser(username: string, signal?: AbortSignal): Promise<Profile> {
  const r = await postJson<Profile & { created: boolean }>("/users/login", { username }, signal);
  return r;
}

/** Save first-run setup (real call: PUT /users/{id}/onboarding). Returns the updated profile. */
export async function saveOnboarding(
  userId: number,
  answers: OnboardingAnswers,
  signal?: AbortSignal,
): Promise<Profile> {
  const response = await fetch(`${API_BASE_URL}/users/${userId}/onboarding`, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(answers),
    signal,
  });
  if (!response.ok) {
    throw new ApiError(
      response.status,
      `PUT /users/${userId}/onboarding failed with ${response.status}`,
      response.headers.get("X-Request-ID"),
    );
  }
  return (await response.json()) as Profile;
}

/** Mirrors apps/api/app/schemas/illustrations.py:IllustrateResponse (the fields used here). */
export interface IllustrateResponse {
  id: string;
  url: string;
}

/** Draw a word (real call: POST /illustrate). `url` is relative to the API. */
export function illustrate(
  body: { text: string; book_id?: number | null },
  signal?: AbortSignal,
): Promise<IllustrateResponse> {
  return postJson<IllustrateResponse>("/illustrate", withBook(body), signal);
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
