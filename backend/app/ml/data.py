from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app import db


@dataclass(frozen=True)
class BaselineSession:
    session_id: str
    status: str
    started_at: int
    ended_at: int | None
    duration: float | None
    events: list[dict[str, Any]]
    snapshots: list[dict[str, Any]]


def load_baseline_sessions() -> list[BaselineSession]:
    """Load completed real sessions from the existing SQLite telemetry store."""
    with db.connection_scope() as connection:
        sessions = connection.execute(
            "SELECT session_id, status, started_at, ended_at, duration "
            "FROM sessions WHERE status = 'ended' ORDER BY started_at, id"
        ).fetchall()
        result = []
        for session in sessions:
            events = connection.execute(
                """
                SELECT type, timestamp, inserted_length, deleted_length, content_length
                FROM events WHERE session_id = ? ORDER BY timestamp, id
                """,
                (session["session_id"],),
            ).fetchall()
            snapshots = connection.execute(
                """
                SELECT timestamp, content_length, word_count
                FROM snapshots WHERE session_id = ? ORDER BY timestamp, id
                """,
                (session["session_id"],),
            ).fetchall()
            result.append(
                BaselineSession(
                    session_id=session["session_id"],
                    status=session["status"],
                    started_at=session["started_at"],
                    ended_at=session["ended_at"],
                    duration=session["duration"],
                    events=[dict(row) for row in events],
                    snapshots=[dict(row) for row in snapshots],
                )
            )
    return result
