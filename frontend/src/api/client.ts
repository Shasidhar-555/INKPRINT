import type { WritingEvent } from "../types";
import type { WritingSnapshot } from "../tracking/snapshotTracker";


const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  "http://localhost:8000";

const REQUEST_TIMEOUT_MS = 10000;

interface SessionCreateResponse {
  session_id: string;
  started_at: number;
  status: string;
}

interface StoredCountResponse {
  stored: number;
}

interface SessionEndResponse {
  status: string;
}

export interface StoredSession {
  sessionId: string;
  startedAt: number;
  endedAt: number | null;
  finalContentLength: number | null;
  duration: number | null;
  status: string;
  events: WritingEvent[];
  snapshots: WritingSnapshot[];
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(
      `${API_BASE_URL}${path}`,
      {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
      }
    );

    if (!response.ok) {
      throw new Error("Backend request failed");
    }

    return await response.json() as T;
  } catch (error) {
    if (error instanceof DOMException &&
      error.name === "AbortError") {
      throw new Error("Backend request timed out", {
        cause: error,
      });
    }

    if (error instanceof Error) throw error;

    throw new Error("Unable to reach InkPrint backend", {
      cause: error,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function createSession(
  sessionId: string,
  startedAt: number
): Promise<SessionCreateResponse> {
  const response = await request<SessionCreateResponse>(
    "/sessions",
    {
      method: "POST",
      body: JSON.stringify({ sessionId, startedAt }),
    }
  );

  if (!response.session_id ||
    typeof response.started_at !== "number") {
    throw new Error("Invalid backend session response");
  }

  return response;
}

export async function sendEvents(
  sessionId: string,
  events: WritingEvent[]
): Promise<StoredCountResponse> {
  const response = await request<StoredCountResponse>(
    `/sessions/${encodeURIComponent(sessionId)}/events`,
    {
      method: "POST",
      body: JSON.stringify({ events }),
    }
  );

  if (response.stored !== events.length) {
    throw new Error("Invalid event upload response");
  }

  return response;
}

export async function sendSnapshots(
  sessionId: string,
  snapshots: WritingSnapshot[]
): Promise<StoredCountResponse> {
  const response = await request<StoredCountResponse>(
    `/sessions/${encodeURIComponent(sessionId)}/snapshots`,
    {
      method: "POST",
      body: JSON.stringify({ snapshots }),
    }
  );

  if (response.stored !== snapshots.length) {
    throw new Error("Invalid snapshot upload response");
  }

  return response;
}

export async function endSession(
  sessionId: string,
  endedAt: number,
  finalContentLength: number,
  duration: number
): Promise<SessionEndResponse> {
  const response = await request<SessionEndResponse>(
    `/sessions/${encodeURIComponent(sessionId)}/end`,
    {
      method: "POST",
      body: JSON.stringify({
        endedAt,
        finalContentLength,
        duration,
      }),
    }
  );

  if (response.status !== "ended") {
    throw new Error("Invalid session end response");
  }

  return response;
}

export async function getSession(
  sessionId: string
): Promise<StoredSession> {
  const response = await request<StoredSession>(
    `/sessions/${encodeURIComponent(sessionId)}`
  );

  if (response.sessionId !== sessionId ||
    !Array.isArray(response.events) ||
    !Array.isArray(response.snapshots)) {
    throw new Error("Invalid stored session response");
  }

  return response;
}
