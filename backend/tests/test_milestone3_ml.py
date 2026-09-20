from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from app.ml.data import BaselineSession
from app.ml.isolation_forest import (
    FEATURE_ORDER,
    MINIMUM_BASELINE_SESSIONS,
    InsufficientBaselineDataError,
    InvalidBaselineSessionError,
    ModelArtifactError,
    load_model,
    score_features,
    score_vector,
    train_model,
)
from app.pipeline.features import extract_features, feature_vector


def baseline_session(index: int) -> BaselineSession:
    first = index + 1
    events = [
        {"type": "session_started", "timestamp": 0, "content_length": 0},
        {"type": "typing", "timestamp": 1000, "inserted_length": first, "content_length": first},
        {"type": "typing", "timestamp": 2000, "inserted_length": first, "content_length": first * 2},
        {"type": "typing", "timestamp": 3000, "inserted_length": first, "content_length": first * 3},
        {"type": "session_ended", "timestamp": 4000, "content_length": first * 3},
    ]
    return BaselineSession(
        session_id=f"baseline-{index}",
        status="ended",
        started_at=0,
        ended_at=4000,
        duration=4000,
        events=events,
        snapshots=[],
    )


def training_sessions() -> list[BaselineSession]:
    return [baseline_session(index) for index in range(MINIMUM_BASELINE_SESSIONS)]


def test_feature_order_is_canonical_and_deterministic():
    features = extract_features(baseline_session(0).events, [])
    assert len(FEATURE_ORDER) == 18
    assert feature_vector(features) == feature_vector(dict(reversed(list(features.items()))))
    assert list(features) != FEATURE_ORDER or tuple(features) == FEATURE_ORDER


def test_insufficient_baseline_does_not_train(tmp_path: Path):
    artifact = tmp_path / "model.pkl"
    with pytest.raises(InsufficientBaselineDataError, match="insufficient_baseline_data"):
        train_model([], artifact)
    with pytest.raises(InsufficientBaselineDataError, match="insufficient_baseline_data"):
        train_model(training_sessions()[:-1], artifact)
    assert not artifact.exists()


def test_invalid_baseline_session_is_rejected(tmp_path: Path):
    invalid = baseline_session(0)
    invalid = BaselineSession(**{**invalid.__dict__, "events": invalid.events[:-1]})
    with pytest.raises(InvalidBaselineSessionError, match="invalid_baseline_session"):
        train_model(training_sessions()[:-1] + [invalid], tmp_path / "model.pkl")


def test_training_creates_loadable_artifact_and_metadata(tmp_path: Path):
    artifact = tmp_path / "model.pkl"
    train_model(training_sessions(), artifact)
    assert artifact.exists()
    assert artifact.with_name("model_metadata.json").exists()
    assert isinstance(load_model(artifact), object)
    metadata = json.loads(artifact.with_name("model_metadata.json").read_text())
    assert metadata["feature_order"] == list(FEATURE_ORDER)
    assert metadata["n_estimators"] == 100
    assert metadata["random_state"] == 42


def test_deterministic_training_and_scoring(tmp_path: Path):
    first_artifact = tmp_path / "first" / "model.pkl"
    second_artifact = tmp_path / "second" / "model.pkl"
    sessions = training_sessions()
    train_model(sessions, first_artifact)
    train_model(sessions, second_artifact)
    features = extract_features(sessions[0].events, [])
    assert score_features(features, first_artifact) == score_features(features, second_artifact)
    assert load_model(first_artifact).random_state == 42


def test_scoring_uses_anomaly_score_convention(tmp_path: Path):
    artifact = tmp_path / "model.pkl"
    sessions = training_sessions()
    train_model(sessions, artifact)
    normal = extract_features(sessions[0].events, [])
    vector = feature_vector(normal)
    score = score_features(normal, artifact)
    expected = -float(load_model(artifact).decision_function([vector])[0])
    assert math.isfinite(score)
    assert score == expected


def test_feature_mismatch_and_nonfinite_values_are_rejected():
    features = extract_features(baseline_session(0).events, [])
    with pytest.raises(ValueError, match="missing features"):
        feature_vector({name: value for name, value in features.items() if name != FEATURE_ORDER[0]})
    with pytest.raises(ValueError, match="unexpected features"):
        feature_vector({**features, "unknown": 1})
    with pytest.raises(ValueError, match="finite"):
        feature_vector({**features, FEATURE_ORDER[0]: float("nan")})
    with pytest.raises(ValueError, match="length_mismatch"):
        score_vector([0.0], Path("missing.pkl"))


def test_missing_and_corrupt_artifacts_are_explicit(tmp_path: Path):
    missing = tmp_path / "missing.pkl"
    with pytest.raises(ModelArtifactError, match="missing_model_artifact"):
        load_model(missing)
    corrupt = tmp_path / "corrupt.pkl"
    corrupt.write_bytes(b"not a pickle")
    corrupt.with_name("model_metadata.json").write_text(json.dumps({}))
    with pytest.raises(ModelArtifactError, match="corrupt_model_artifact"):
        load_model(corrupt)
