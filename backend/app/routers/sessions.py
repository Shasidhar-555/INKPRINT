from __future__ import annotations

import json
import sqlite3

from fastapi import APIRouter, HTTPException, status

from app.db import connection_scope
from app.pipeline.features import analyze_session
from app.schemas import (
    EventBatchRequest,
    SessionCreateRequest,
    SessionCreateResponse,
    SessionEndRequest,
    SessionEndResponse,
    SessionResponse,
    SnapshotBatchRequest,
)


router = APIRouter(prefix="/sessions", tags=["sessions"])


def _require_session(connection: sqlite3.Connection, session_id: str) -> sqlite3.Row:
    session = connection.execute(
        "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
    ).fetchone()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post("", response_model=SessionCreateResponse, status_code=status.HTTP_201_CREATED)
def create_session(payload: SessionCreateRequest) -> SessionCreateResponse:
    try:
        with connection_scope() as connection:
            connection.execute(
                "INSERT INTO sessions (session_id, started_at) VALUES (?, ?)",
                (payload.sessionId, payload.startedAt),
            )
    except sqlite3.IntegrityError as error:
        raise HTTPException(status_code=409, detail="Session already exists") from error
    return SessionCreateResponse(
        session_id=payload.sessionId, started_at=payload.startedAt, status="in_progress"
    )


@router.post("/{session_id}/events", status_code=status.HTTP_201_CREATED)
def add_events(session_id: str, payload: EventBatchRequest) -> dict[str, int]:
    try:
        with connection_scope() as connection:
            _require_session(connection, session_id)
            connection.executemany(
                """
                INSERT INTO events (
                    session_id, event_id, type, timestamp, cursor_position,
                    inserted_length, deleted_length, content_length
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        session_id,
                        event.id,
                        event.type,
                        event.timestamp,
                        event.cursorPosition,
                        event.insertedLength,
                        event.deletedLength,
                        event.contentLength,
                    )
                    for event in payload.events
                ],
            )
    except sqlite3.IntegrityError as error:
        raise HTTPException(status_code=409, detail="Duplicate event id") from error
    return {"stored": len(payload.events)}


@router.post("/{session_id}/snapshots", status_code=status.HTTP_201_CREATED)
def add_snapshots(session_id: str, payload: SnapshotBatchRequest) -> dict[str, int]:
    try:
        with connection_scope() as connection:
            _require_session(connection, session_id)
            connection.executemany(
                """
                INSERT INTO snapshots (
                    session_id, snapshot_id, timestamp, content_length, word_count
                ) VALUES (?, ?, ?, ?, ?)
                """,
                [
                    (
                        session_id,
                        snapshot.id,
                        snapshot.timestamp,
                        snapshot.contentLength,
                        snapshot.wordCount,
                    )
                    for snapshot in payload.snapshots
                ],
            )
    except sqlite3.IntegrityError as error:
        raise HTTPException(status_code=409, detail="Duplicate snapshot id") from error
    return {"stored": len(payload.snapshots)}


@router.post("/{session_id}/end", response_model=SessionEndResponse)
def end_session(session_id: str, payload: SessionEndRequest) -> SessionEndResponse:
    try:
      with connection_scope() as connection:
        session = _require_session(connection, session_id)
        existing = connection.execute("SELECT result_json FROM session_analyses WHERE session_id = ?", (session_id,)).fetchone()
        if existing:
            return SessionEndResponse(status="ended", analysis=json.loads(existing["result_json"]))
        if payload.endedAt < session["started_at"]:
            raise HTTPException(status_code=422, detail="endedAt precedes startedAt")
        events = [dict(row) for row in connection.execute("SELECT type, timestamp, inserted_length, deleted_length, content_length FROM events WHERE session_id = ? ORDER BY timestamp, id", (session_id,))]
        snapshots = [dict(row) for row in connection.execute("SELECT timestamp, content_length, word_count FROM snapshots WHERE session_id = ? ORDER BY timestamp, id", (session_id,))]
        analysis = analyze_session(events, snapshots)
        connection.execute(
            """
            UPDATE sessions
            SET ended_at = ?, final_content_length = ?, duration = ?, status = 'ended'
            WHERE session_id = ?
            """,
            (payload.endedAt, payload.finalContentLength, payload.duration, session_id),
        )
        connection.execute("INSERT INTO session_analyses (session_id, result_json) VALUES (?, ?)", (session_id, json.dumps(analysis)))
        return SessionEndResponse(status="ended", analysis=analysis)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail="Unable to finalize session analysis") from error


@router.get("/{session_id}", response_model=SessionResponse)
def get_session(session_id: str) -> SessionResponse:
    with connection_scope() as connection:
        session = _require_session(connection, session_id)
        events = connection.execute(
            """
            SELECT event_id, type, timestamp, cursor_position, inserted_length,
                   deleted_length, content_length
            FROM events WHERE session_id = ? ORDER BY timestamp, id
            """,
            (session_id,),
        ).fetchall()
        snapshots = connection.execute(
            """
            SELECT snapshot_id, timestamp, content_length, word_count
            FROM snapshots WHERE session_id = ? ORDER BY timestamp, id
            """,
            (session_id,),
        ).fetchall()
        analysis = connection.execute("SELECT result_json FROM session_analyses WHERE session_id = ?", (session_id,)).fetchone()
    return SessionResponse(
        sessionId=session["session_id"],
        startedAt=session["started_at"],
        endedAt=session["ended_at"],
        finalContentLength=session["final_content_length"],
        duration=session["duration"],
        status=session["status"],
        events=[
            {
                "id": event["event_id"], "type": event["type"],
                "timestamp": event["timestamp"],
                "cursorPosition": event["cursor_position"],
                "insertedLength": event["inserted_length"],
                "deletedLength": event["deleted_length"],
                "contentLength": event["content_length"],
            }
            for event in events
        ],
        snapshots=[
            {
                "id": snapshot["snapshot_id"], "timestamp": snapshot["timestamp"],
                "contentLength": snapshot["content_length"], "wordCount": snapshot["word_count"],
            }
            for snapshot in snapshots
        ],
        analysis=json.loads(analysis["result_json"]) if analysis else None,
    )
