from __future__ import annotations

import sys

from app.ml.data import load_baseline_sessions
from app.ml.isolation_forest import (
    InsufficientBaselineDataError,
    InvalidBaselineSessionError,
    train_model,
)


def main() -> int:
    try:
        sessions = load_baseline_sessions()
        artifact_path = train_model(sessions)
    except (InsufficientBaselineDataError, InvalidBaselineSessionError) as error:
        print(str(error), file=sys.stderr)
        return 2
    print(f"trained_model: {artifact_path} ({len(sessions)} sessions)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
