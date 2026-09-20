from app.pipeline.features import extract_features


def event(event_type, timestamp, **values):
    return {"id": f"{event_type}-{timestamp}", "type": event_type, "timestamp": timestamp, **values}


def test_normal_typing_session():
    result = extract_features([
        event("session_started", 0, contentLength=0),
        event("typing", 1000, insertedLength=3, contentLength=3),
        event("session_ended", 2000, contentLength=3),
    ], [], {"duration": 2000})
    assert result["typing_character_count"] == 3
    assert result["typing_event_rate"] == 0.5


def test_paste_heavy_session_and_paste_is_not_typing():
    result = extract_features([
        event("paste", 0, insertedLength=100, contentLength=100),
        event("typing", 1000, insertedLength=5, contentLength=105),
    ], [], {"duration": 1000})
    assert result["paste_count"] == 1
    assert result["paste_character_count"] == 100
    assert result["typing_character_count"] == 5
    assert result["paste_ratio"] == 100 / 105


def test_deletion_heavy_session():
    result = extract_features([
        event("typing", 0, insertedLength=10, contentLength=10),
        event("delete", 1000, deletedLength=8, contentLength=2),
    ], [], {"duration": 1000})
    assert result["deletion_character_count"] == 8
    assert result["deletion_ratio"] == 0.8


def test_pause_and_inactivity_session():
    result = extract_features([
        event("typing", 0, insertedLength=1, contentLength=1),
        event("pause", 10000, contentLength=1),
    ], [], {"duration": 10000})
    assert result["pause_count"] == 1
    assert result["average_inter_event_gap"] == 10
    assert result["max_inactivity_gap"] == 10


def test_empty_session():
    result = extract_features([], [], {"duration": 0})
    assert result["session_duration"] == 0
    assert result["max_inactivity_gap"] == 0


def test_one_event_and_zero_duration_sessions():
    result = extract_features([event("typing", 0, insertedLength=1)], [], {"duration": 0})
    assert result["typing_event_rate"] == 0
    assert result["average_inter_event_gap"] == 0


def test_snapshot_growth():
    result = extract_features([], [
        {"id": "a", "timestamp": 0, "contentLength": 0, "wordCount": 0},
        {"id": "b", "timestamp": 2000, "contentLength": 10, "wordCount": 2},
        {"id": "c", "timestamp": 4000, "contentLength": 25, "wordCount": 5},
    ])
    assert result["document_growth_rate"] == 6.25
    assert result["max_document_growth_jump"] == 15


def test_mixed_typing_paste_and_deletion():
    result = extract_features([
        event("typing", 0, insertedLength=4, contentLength=4),
        event("paste", 500, insertedLength=6, contentLength=10),
        event("delete", 1000, deletedLength=2, contentLength=8),
    ], [], {"duration": 1000})
    assert result["typing_character_count"] == 4
    assert result["paste_character_count"] == 6
    assert result["deletion_character_count"] == 2
