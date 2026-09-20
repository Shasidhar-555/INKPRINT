import type { WritingEvent } from "../types";

export interface BehavioralFeatures {
  sessionDurationMs: number;
  totalTypedChars: number;
  pasteCharacters: number;
  pasteCount: number;
  totalAddedChars: number;
  totalDeletedChars: number;
  editCount: number;
  typingEventCount: number;
  deletionEventCount: number;
  typingSpeedCharsPerMinute: number;
  deletionRate: number;
  correctionRate: number;
  pauseCount: number;
  averagePauseMs: number;
  netCharacters: number;
}

export function extractFeatures(
  events: WritingEvent[]
): BehavioralFeatures {
  if (events.length === 0) {
    return {
      sessionDurationMs: 0,
      totalTypedChars: 0,
      pasteCharacters: 0,
      pasteCount: 0,
      totalAddedChars: 0,
      totalDeletedChars: 0,
      editCount: 0,
      typingEventCount: 0,
      deletionEventCount: 0,
      typingSpeedCharsPerMinute: 0,
      deletionRate: 0,
      correctionRate: 0,
      pauseCount: 0,
      averagePauseMs: 0,
      netCharacters: 0,
    };
  }

  const start = events[0].timestamp;
  const end = events[events.length - 1].timestamp;
  const sessionDurationMs = Math.max(end - start, 1);

  const typingEvents = events.filter(
    (event) => event.type === "typing"
  );

  const pasteEvents = events.filter(
    (event) => event.type === "paste"
  );

  const deletionEvents = events.filter(
    (event) => event.type === "delete"
  );

  const pauseEvents = events.filter(
    (event) => event.type === "pause"
  );

  const totalTypedChars = typingEvents.reduce(
    (sum, event) => sum + (event.insertedLength ?? 0),
    0
  );

  const pasteCharacters = pasteEvents.reduce(
    (sum, event) => sum + (event.insertedLength ?? 0),
    0
  );

  const totalDeletedChars = deletionEvents.reduce(
    (sum, event) => sum + (event.deletedLength ?? 0),
    0
  );

  const pauseDurations = pauseEvents
  .map((pauseEvent) => {
    const pauseIndex = events.findIndex(
      (event) => event.id === pauseEvent.id
    );

    const next = events[ pauseIndex + 1 ];

    if (!next) return 3000;

    // Pause events are emitted once the three-second threshold is reached.
    return 3000 + Math.max(next.timestamp - pauseEvent.timestamp, 0);
  })
  .filter((duration) => duration > 0);

  const averagePauseMs =
    pauseDurations.length > 0
      ? pauseDurations.reduce((a, b) => a + b, 0) /
        pauseDurations.length
      : 0;

  const minutes = sessionDurationMs / 60000;

  const typingSpeedCharsPerMinute =
    minutes > 0 ? totalTypedChars / minutes : 0;

  const editCount = typingEvents.length + deletionEvents.length;

  const deletionRate =
    totalTypedChars > 0
      ? totalDeletedChars / totalTypedChars
      : 0;

  const correctionRate =
    editCount > 0
      ? deletionEvents.length / editCount
      : 0;

  return {
    sessionDurationMs,
    totalTypedChars,
    pasteCharacters,
    pasteCount: pasteEvents.length,
    totalAddedChars: totalTypedChars + pasteCharacters,
    totalDeletedChars,
    editCount,
    typingEventCount: typingEvents.length,
    deletionEventCount: deletionEvents.length,
    typingSpeedCharsPerMinute,
    deletionRate,
    correctionRate,
    pauseCount: pauseEvents.length,
    averagePauseMs,
    netCharacters: totalTypedChars - totalDeletedChars,
  };
}