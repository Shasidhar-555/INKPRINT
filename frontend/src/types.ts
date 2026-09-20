export type EventType =
  | "session_started"
  | "session_ended"
  | "typing"
  | "paste"
  | "delete"
  | "pause";

export interface WritingEvent {
  id: string;
  type: EventType;
  timestamp: number;

  cursorPosition?: number;

  insertedLength?: number;

  deletedLength?: number;

  contentLength?: number;
}

export interface SessionPayload {
  sessionId: string;
  startedAt: number;
  endedAt: number;
  events: WritingEvent[];
  snapshots: WritingSnapshot[];
  finalContentLength: number;
  duration: number;
}
import type { WritingSnapshot } from "./tracking/snapshotTracker";
