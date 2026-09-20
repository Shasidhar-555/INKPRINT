from __future__ import annotations

from collections.abc import Mapping, Sequence
import math
from statistics import pstdev
from typing import Any


MINIMUM_EVENT_COUNT = 5

FEATURE_ORDER = (
    "session_duration",
    "typing_character_count",
    "paste_count",
    "paste_character_count",
    "typing_velocity",
    "paste_frequency",
    "paste_ratio",
    "deletion_character_count",
    "deletion_ratio",
    "pause_count",
    "pause_duration",
    "average_inter_event_gap",
    "max_inactivity_gap",
    "typing_event_rate",
    "burst_irregularity",
    "burst_irregularity_available",
    "document_growth_rate",
    "max_document_growth_jump",
)


def safe_divide(a: float | int, b: float | int, default: float = 0.0) -> float:
    if b <= 0 or not math.isfinite(float(a)) or not math.isfinite(float(b)):
        return default
    result = float(a) / float(b)
    return result if math.isfinite(result) else default


def _value(item: Any, name: str, default: Any = None) -> Any:
    if isinstance(item, Mapping):
        return item.get(name, default)
    return getattr(item, name, default)


def _duration_seconds(events: Sequence[Any], session: Any | None) -> float:
    del session
    starts = [float(_value(event, "timestamp")) for event in events if _value(event, "type") == "session_started"]
    ends = [float(_value(event, "timestamp")) for event in events if _value(event, "type") == "session_ended"]
    if starts and ends:
        return max((max(ends) - min(starts)) / 1000, 0.0)
    timestamps = [float(_value(event, "timestamp")) for event in events]
    return (max(timestamps) - min(timestamps)) / 1000 if len(timestamps) > 1 else 0.0


def _growth_points(events: Sequence[Any], snapshots: Sequence[Any]) -> list[tuple[float, float]]:
    event_points = [
        (float(_value(item, "timestamp")), float(_value(item, "contentLength", _value(item, "content_length"))))
        for item in events
        if _value(item, "contentLength", _value(item, "content_length")) is not None
    ]
    source = event_points if len(event_points) >= 2 else snapshots
    if source is event_points:
        return sorted(event_points)
    points = [
        (float(_value(item, "timestamp")), float(_value(item, "contentLength", _value(item, "content_length"))))
        for item in source
        if _value(item, "contentLength", _value(item, "content_length")) is not None
    ]
    return sorted(points)


def extract_features(
    events: Sequence[Any], snapshots: Sequence[Any], session: Any | None = None
) -> dict[str, float | int]:
    """Derive deterministic, content-free features from captured telemetry."""
    ordered_events = sorted(events, key=lambda event: _value(event, "timestamp"))
    typing_characters = sum(
        int(_value(event, "insertedLength", _value(event, "inserted_length", 0)) or 0)
        for event in ordered_events if _value(event, "type") == "typing"
    )
    paste_characters = sum(
        int(_value(event, "insertedLength", _value(event, "inserted_length", 0)) or 0)
        for event in ordered_events if _value(event, "type") == "paste"
    )
    deleted_characters = sum(
        int(_value(event, "deletedLength", _value(event, "deleted_length", 0)) or 0)
        for event in ordered_events if _value(event, "type") == "delete"
    )
    duration = _duration_seconds(ordered_events, session)
    timestamps = [float(_value(event, "timestamp")) for event in ordered_events]
    gaps = [(right - left) / 1000 for left, right in zip(timestamps, timestamps[1:])]
    additions = typing_characters + paste_characters
    points = _growth_points(ordered_events, snapshots)
    growth_rate = 0.0
    if len(points) >= 2 and points[-1][0] > points[0][0]:
        growth_rate = safe_divide(points[-1][1] - points[0][1], (points[-1][0] - points[0][0]) / 1000)
    jumps = [right[1] - left[1] for left, right in zip(points, points[1:])]
    typing_timestamps = [float(_value(event, "timestamp")) for event in ordered_events if _value(event, "type") == "typing"]
    typing_gaps = [(right - left) / 1000 for left, right in zip(typing_timestamps, typing_timestamps[1:])]
    usable_typing_gaps = [gap for gap in typing_gaps if gap > 0]
    burst_available = int(len(typing_timestamps) >= 3 and len(usable_typing_gaps) >= 2)
    burst_irregularity = safe_divide(pstdev(usable_typing_gaps), sum(usable_typing_gaps) / len(usable_typing_gaps)) if burst_available else 0.0
    pause_duration = 0.0
    for index, event in enumerate(ordered_events):
        if _value(event, "type") == "pause" and index + 1 < len(ordered_events):
            pause_duration += max((float(_value(ordered_events[index + 1], "timestamp")) - float(_value(event, "timestamp"))) / 1000, 0.0)

    return {
        "session_duration": duration,
        "typing_character_count": typing_characters,
        "paste_count": sum(1 for event in ordered_events if _value(event, "type") == "paste"),
        "paste_character_count": paste_characters,
        "typing_velocity": safe_divide(typing_characters, duration),
        "paste_frequency": safe_divide(len(paste_events := [event for event in ordered_events if _value(event, "type") == "paste"]), duration),
        "paste_ratio": safe_divide(paste_characters, additions),
        "deletion_character_count": deleted_characters,
        "deletion_ratio": safe_divide(deleted_characters, additions),
        "pause_count": sum(1 for event in ordered_events if _value(event, "type") == "pause"),
        "pause_duration": pause_duration,
        "average_inter_event_gap": safe_divide(sum(gaps), len(gaps)),
        "max_inactivity_gap": max(gaps, default=0.0),
        "typing_event_rate": safe_divide(len(typing_timestamps), duration),
        "burst_irregularity": burst_irregularity,
        "burst_irregularity_available": burst_available,
        "document_growth_rate": growth_rate,
        "max_document_growth_jump": max(jumps, default=0.0),
    }


def feature_vector(features: Mapping[str, Any]) -> list[float]:
    missing = [name for name in FEATURE_ORDER if name not in features]
    unexpected = [name for name in features if name not in FEATURE_ORDER]
    if missing or unexpected:
        details = []
        if missing:
            details.append(f"missing features: {', '.join(missing)}")
        if unexpected:
            details.append(f"unexpected features: {', '.join(unexpected)}")
        raise ValueError("Invalid feature set; " + "; ".join(details))

    vector = []
    for name in FEATURE_ORDER:
        value = features[name]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"Feature '{name}' must be numeric")
        numeric_value = float(value)
        if not math.isfinite(numeric_value):
            raise ValueError(f"Feature '{name}' must be finite")
        vector.append(numeric_value)
    return vector


def analyze_session(events: Sequence[Any], snapshots: Sequence[Any]) -> dict[str, Any]:
    if len(events) < MINIMUM_EVENT_COUNT:
        return {"status": "insufficient_data", "reason": f"At least {MINIMUM_EVENT_COUNT} events are required", "eventCount": len(events), "features": None}
    return {"status": "ready", "reason": None, "eventCount": len(events), "features": extract_features(events, snapshots)}
