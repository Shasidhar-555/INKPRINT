# InkPrint telemetry backend

This stage stores behavioral telemetry and extracts measurable features. It does not determine authorship, cheating, or AI use.

## Setup

From `backend` on Windows:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The API listens on `http://127.0.0.1:8000`; the configured frontend development origin is `http://localhost:5555`. SQLite data is stored at `backend/inkprint.db` and is created on startup.

## API

- `GET /health`
- `POST /sessions` — `{ "sessionId": "uuid", "startedAt": 1000 }`
- `POST /sessions/{session_id}/events` — `{ "events": [...] }`
- `POST /sessions/{session_id}/snapshots` — `{ "snapshots": [...] }`
- `POST /sessions/{session_id}/end` — `{ "endedAt": 2000, "finalContentLength": 12, "duration": 1000 }`
- `GET /sessions/{session_id}`

Example:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
Invoke-RestMethod -Method Post http://127.0.0.1:8000/sessions -ContentType application/json -Body '{"sessionId":"demo-session","startedAt":1000}'
```

The service stores session metadata, event metadata, and snapshot metadata only—never raw document text. It extracts: session duration; typing, paste, and deletion counts/ratios; pause count; inter-event gaps; typing-event rate; document growth rate; and maximum document-growth jump.

## Milestone 3 model training

Completed sessions in `inkprint.db` are the real baseline source. A minimum of 10 completed baseline sessions is required; no synthetic sessions are generated. Train the Isolation Forest from `backend` with:

```powershell
.\.venv\Scripts\python.exe train_model.py
```

The command writes `artifacts/model.pkl` and `artifacts/model_metadata.json`. With an empty or undersized baseline it exits with `insufficient_baseline_data` and does not create a model. The model uses the canonical `FEATURE_ORDER` in `app/pipeline/features.py` and scores with `-decision_function`, where higher values are more anomalous.

## Current limitations

Snapshot records contain counts rather than text, and events capture net text changes rather than full keystroke or selection details. The Isolation Forest foundation is present, but calibration, risk scoring, decision logic, dashboard views, authentication, and authorship/AI-use determination are not implemented.
