import type { WritingEvent } from "../types";

export function createEvent(
  event: Omit<WritingEvent, "id" | "timestamp">
): WritingEvent {
  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    ...event,
  };
}