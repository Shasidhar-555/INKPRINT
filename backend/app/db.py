from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


DATABASE_PATH = Path(__file__).resolve().parent.parent / "inkprint.db"


def get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


@contextmanager
def connection_scope() -> Iterator[sqlite3.Connection]:
    connection = get_connection()
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database() -> None:
    with connection_scope() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT UNIQUE NOT NULL,
                started_at INTEGER NOT NULL,
                ended_at INTEGER,
                final_content_length INTEGER,
                duration REAL,
                status TEXT NOT NULL DEFAULT 'in_progress'
            );

            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                event_id TEXT NOT NULL,
                type TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                cursor_position INTEGER,
                inserted_length INTEGER,
                deleted_length INTEGER,
                content_length INTEGER,
                FOREIGN KEY(session_id) REFERENCES sessions(session_id),
                UNIQUE(session_id, event_id)
            );

            CREATE TABLE IF NOT EXISTS snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                snapshot_id TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                content_length INTEGER,
                word_count INTEGER,
                FOREIGN KEY(session_id) REFERENCES sessions(session_id),
                UNIQUE(session_id, snapshot_id)
            );

            CREATE TABLE IF NOT EXISTS session_analyses (
                session_id TEXT PRIMARY KEY,
                result_json TEXT NOT NULL,
                FOREIGN KEY(session_id) REFERENCES sessions(session_id)
            );

            CREATE INDEX IF NOT EXISTS idx_events_session_timestamp
                ON events(session_id, timestamp);
            CREATE INDEX IF NOT EXISTS idx_snapshots_session_timestamp
                ON snapshots(session_id, timestamp);
            """
        )
