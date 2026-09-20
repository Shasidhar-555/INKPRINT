import math

import pytest
from fastapi.testclient import TestClient

import app.db as db
from app.main import app
from app.pipeline.features import analyze_session, extract_features


def event(kind, timestamp, **values):
    return {"id": f"{kind}-{timestamp}", "type": kind, "timestamp": timestamp, **values}


def assert_finite(features):
    assert all(math.isfinite(value) for value in features.values() if isinstance(value, (int, float)))


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DATABASE_PATH", tmp_path / "test.db")
    with TestClient(app) as test_client:
        yield test_client


def test_safe_feature_edge_cases():
    cases = [
        [],
        [event("paste", 0, insertedLength=12, contentLength=12)],
        [event("typing", 0, insertedLength=1, contentLength=1)],
        [event("typing", 0, insertedLength=1), event("typing", 1000, insertedLength=1)],
        [event("typing", 0, insertedLength=1), event("typing", 1000, insertedLength=1), event("typing", 3000, insertedLength=1)],
    ]
    for events in cases:
        assert_finite(extract_features(events, []))
    assert extract_features(cases[1], [])["deletion_ratio"] == 0
    assert extract_features(cases[2], [])["burst_irregularity_available"] == 0
    assert extract_features(cases[3], [])["burst_irregularity_available"] == 0
    assert extract_features(cases[4], [])["burst_irregularity_available"] == 1


def test_event_growth_trailing_pause_and_insufficient_data():
    events = [
        event("session_started", 0, contentLength=0),
        event("typing", 1000, insertedLength=2, contentLength=2),
        event("pause", 2000, contentLength=2),
        event("session_ended", 5000, contentLength=10),
    ]
    features = extract_features(events, [])
    assert features["document_growth_rate"] == 2.0
    assert features["pause_duration"] == 3
    assert_finite(features)
    result = analyze_session(events, [])
    assert result["status"] == "insufficient_data"
    assert result["features"] is None


def test_missing_sessions_return_404(client):
    assert client.post("/sessions/missing/events", json={"events": []}).status_code == 404
    assert client.post("/sessions/missing/snapshots", json={"snapshots": []}).status_code == 404
    assert client.post("/sessions/missing/end", json={"endedAt": 1, "finalContentLength": 0, "duration": 1}).status_code == 404


def test_end_is_idempotent_and_event_duplicates_are_rejected(client):
    assert client.get("/health").json() == {"status": "ok"}
    session_id = "milestone-two"
    assert client.post("/sessions", json={"sessionId": session_id, "startedAt": 0}).status_code == 201
    events = [
        event("session_started", 0, contentLength=0),
        event("typing", 1000, insertedLength=1, contentLength=1),
        event("typing", 2000, insertedLength=1, contentLength=2),
        event("typing", 3000, insertedLength=1, contentLength=3),
        event("session_ended", 4000, contentLength=3),
    ]
    assert client.post(f"/sessions/{session_id}/events", json={"events": events}).status_code == 201
    assert client.post(f"/sessions/{session_id}/events", json={"events": events}).status_code == 409
    assert client.post(f"/sessions/{session_id}/snapshots", json={"snapshots": [{"id": "s1", "timestamp": 2000, "contentLength": 2, "wordCount": 1}]}).status_code == 201
    first = client.post(f"/sessions/{session_id}/end", json={"endedAt": 4000, "finalContentLength": 3, "duration": 4000})
    second = client.post(f"/sessions/{session_id}/end", json={"endedAt": 4000, "finalContentLength": 3, "duration": 4000})
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert client.get(f"/sessions/{session_id}").json()["analysis"] == first.json()["analysis"]
    with db.connection_scope() as connection:
        assert connection.execute("SELECT COUNT(*) FROM session_analyses WHERE session_id = ?", (session_id,)).fetchone()[0] == 1
