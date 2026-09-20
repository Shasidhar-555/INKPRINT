export interface WritingSnapshot {
  id: string;
  timestamp: number;
  contentLength: number;
  wordCount: number;
}

export function createSnapshot(
  text: string
): WritingSnapshot {
  const wordCount = text.trim()
    ? text.trim().split(/\s+/).length
    : 0;

  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    contentLength: text.length,
    wordCount,
  };
}