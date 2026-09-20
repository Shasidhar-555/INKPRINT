from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
import json
from pathlib import Path
import math
import pickle
from typing import Any

from sklearn.ensemble import IsolationForest

from app.ml.data import BaselineSession
from app.pipeline.features import (
    FEATURE_ORDER,
    MINIMUM_EVENT_COUNT,
    extract_features,
    feature_vector,
)


ARTIFACT_PATH = Path(__file__).resolve().parents[2] / "artifacts" / "model.pkl"
METADATA_PATH = ARTIFACT_PATH.with_name("model_metadata.json")
MINIMUM_BASELINE_SESSIONS = 10
N_ESTIMATORS = 100
MAX_SAMPLES: float = 1.0
RANDOM_STATE = 42


class ModelArtifactError(RuntimeError):
    pass


class InsufficientBaselineDataError(RuntimeError):
    pass


class InvalidBaselineSessionError(RuntimeError):
    pass


def _metadata() -> dict[str, Any]:
    return {
        "feature_order": list(FEATURE_ORDER),
        "model": "sklearn.ensemble.IsolationForest",
        "n_estimators": N_ESTIMATORS,
        "max_samples": MAX_SAMPLES,
        "random_state": RANDOM_STATE,
    }


def _features_for_session(session: BaselineSession) -> dict[str, float | int]:
    if session.status != "ended" or session.ended_at is None:
        raise InvalidBaselineSessionError(
            f"invalid_baseline_session: {session.session_id} is not ended"
        )
    if len(session.events) < MINIMUM_EVENT_COUNT:
        raise InvalidBaselineSessionError(
            f"invalid_baseline_session: {session.session_id} has fewer than "
            f"{MINIMUM_EVENT_COUNT} events"
        )
    features = extract_features(session.events, session.snapshots, session)
    feature_vector(features)
    return features


def train_model(
    sessions: Sequence[BaselineSession],
    artifact_path: Path = ARTIFACT_PATH,
) -> Path:
    if len(sessions) < MINIMUM_BASELINE_SESSIONS:
        raise InsufficientBaselineDataError(
            "insufficient_baseline_data: "
            f"{len(sessions)} completed sessions available; "
            f"{MINIMUM_BASELINE_SESSIONS} required"
        )

    vectors = [feature_vector(_features_for_session(session)) for session in sessions]
    model = IsolationForest(
        n_estimators=N_ESTIMATORS,
        max_samples=MAX_SAMPLES,
        random_state=RANDOM_STATE,
    )
    model.fit(vectors)

    artifact_path = Path(artifact_path)
    metadata_path = artifact_path.with_name("model_metadata.json")
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    with artifact_path.open("wb") as artifact_file:
        pickle.dump(model, artifact_file, protocol=pickle.HIGHEST_PROTOCOL)
    metadata = {
        **_metadata(),
        "training_session_count": len(sessions),
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return artifact_path


def load_model(
    artifact_path: Path = ARTIFACT_PATH,
) -> IsolationForest:
    artifact_path = Path(artifact_path)
    metadata_path = artifact_path.with_name("model_metadata.json")
    if not artifact_path.exists():
        raise ModelArtifactError(f"missing_model_artifact: {artifact_path}")
    if not metadata_path.exists():
        raise ModelArtifactError(f"missing_model_metadata: {metadata_path}")
    try:
        with artifact_path.open("rb") as artifact_file:
            model = pickle.load(artifact_file)
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except Exception as error:
        raise ModelArtifactError(f"corrupt_model_artifact: {artifact_path}") from error
    if not isinstance(model, IsolationForest):
        raise ModelArtifactError("corrupt_model_artifact: unexpected model type")
    if metadata.get("feature_order") != list(FEATURE_ORDER):
        raise ModelArtifactError("model_feature_order_mismatch")
    if metadata.get("random_state") != RANDOM_STATE:
        raise ModelArtifactError("model_random_state_mismatch")
    if metadata.get("n_estimators") != N_ESTIMATORS:
        raise ModelArtifactError("model_parameter_mismatch: n_estimators")
    if metadata.get("max_samples") != MAX_SAMPLES:
        raise ModelArtifactError("model_parameter_mismatch: max_samples")
    return model


def score_vector(
    vector: Sequence[float],
    artifact_path: Path = ARTIFACT_PATH,
) -> float:
    if len(vector) != len(FEATURE_ORDER):
        raise ValueError(
            f"feature_vector_length_mismatch: expected {len(FEATURE_ORDER)}, "
            f"received {len(vector)}"
        )
    numeric_vector = []
    for index, value in enumerate(vector):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"Feature at index {index} must be numeric")
        numeric_value = float(value)
        if not math.isfinite(numeric_value):
            raise ValueError(f"Feature at index {index} must be finite")
        numeric_vector.append(numeric_value)
    model = load_model(artifact_path)
    score = -float(model.decision_function([numeric_vector])[0])
    if not math.isfinite(score):
        raise ValueError("anomaly_score_not_finite")
    return score


def score_features(
    features: Mapping[str, Any],
    artifact_path: Path = ARTIFACT_PATH,
) -> float:
    return score_vector(feature_vector(features), artifact_path)
