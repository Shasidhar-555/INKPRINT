from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SessionRecord:
    session_id: str
    started_at: int
    ended_at: int | None
    final_content_length: int | None
    duration: float | None
    status: str


@dataclass(frozen=True)
class EventRecord:
    id: str
    type: str
    timestamp: int
    cursor_position: int | None
    inserted_length: int | None
    deleted_length: int | None
    content_length: int | None


@dataclass(frozen=True)
class SnapshotRecord:
    id: str
    timestamp: int
    content_length: int | None
    word_count: int | None
