from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


EventType = Literal[
    "session_started",
    "session_ended",
    "typing",
    "paste",
    "delete",
    "pause",
]


class EventPayload(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    type: EventType
    timestamp: int = Field(ge=0)
    cursorPosition: int | None = Field(default=None, ge=0)
    insertedLength: int | None = Field(default=None, ge=0)
    deletedLength: int | None = Field(default=None, ge=0)
    contentLength: int | None = Field(default=None, ge=0)


class SnapshotPayload(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    timestamp: int = Field(ge=0)
    contentLength: int | None = Field(default=None, ge=0)
    wordCount: int | None = Field(default=None, ge=0)


class SessionCreateRequest(StrictModel):
    sessionId: str = Field(min_length=1, max_length=128)
    startedAt: int = Field(ge=0)


class SessionCreateResponse(StrictModel):
    session_id: str
    started_at: int
    status: str


class EventBatchRequest(StrictModel):
    events: list[EventPayload]


class SnapshotBatchRequest(StrictModel):
    snapshots: list[SnapshotPayload]


class SessionEndRequest(StrictModel):
    endedAt: int = Field(ge=0)
    finalContentLength: int = Field(ge=0)
    duration: float = Field(ge=0)


class AnalysisResult(StrictModel):
    status: Literal["ready", "insufficient_data"]
    reason: str | None
    eventCount: int = Field(ge=0)
    features: dict[str, float | int] | None


class SessionEndResponse(StrictModel):
    status: str
    analysis: AnalysisResult


class SessionResponse(StrictModel):
    sessionId: str
    startedAt: int
    endedAt: int | None
    finalContentLength: int | None
    duration: float | None
    status: str
    events: list[EventPayload]
    snapshots: list[SnapshotPayload]
    analysis: AnalysisResult | None = None
