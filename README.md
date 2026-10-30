# InkPrint — Writing Intelligence

InkPrint is a writing-process analytics prototype that explores how a document is created—not just what the final text looks like.

It captures opted-in writing-session activity, converts that activity into measurable behavioral features, and uses those features to provide explainable writing-process insights and improvement suggestions.

> **Important:** InkPrint is a learning and self-reflection tool. Its behavioral indicators are not definitive judgments about a person's ability, intent, authorship, or use of AI.

## Why InkPrint?

A finished document hides the process behind it. Two documents can look similar even when the writing processes that produced them are very different.

InkPrint explores whether signals such as pauses, revisions, typing activity, and pasted content can help learners reflect on their writing habits and identify areas to improve.

## What it currently does

- **Writing-session tracking:** Starts and ends a writing session and records relevant activity events.
- **Behavioral event capture:** Records event metadata for typing, pasting, deletion, pauses, and session lifecycle.
- **Snapshot metadata:** Records document measurements such as content length and word count, rather than storing the document text.
- **Feature extraction:** Derives measurable signals including typing velocity, pause frequency, revision/deletion ratios, paste proportion, inter-event gaps, and document growth.
- **Writing-process insights:** The frontend maps extracted signals to explainable skill indicators and personalized recommendations.
- **Progress tracking:** Keeps a short history of session metrics in browser local storage so users can compare changes over time.
- **ML foundation:** Includes a backend Isolation Forest training and scoring module for anomaly-oriented analysis of completed sessions.

The insights are intended to support reflection, not to label a writer or make high-stakes decisions.

## How it works

\`\`\`mermaid
flowchart TD
    A[User starts a writing session] --> B[Frontend captures activity events]
    B --> C[Snapshot metadata is recorded]
    C --> D[Events and snapshots sent to FastAPI]
    D --> E[SQLite stores session data]
    E --> F[Backend extracts session features]
    F --> G[Completed-session data can form an ML baseline]
    G --> H[Isolation Forest training and scoring module]
    B --> I[Frontend analyzes writing signals]
    I --> J[Explainable skill indicators and recommendations]
    J --> K[Session metric history in browser storage]
\`\`\`

**Current implementation note:** The frontend's skill insights and recommendations use feature-based, rule-driven logic. The backend Isolation Forest is a separate ML foundation that can be trained from completed sessions; it is not currently wired into the live frontend recommendation flow.

## Technology stack

| Area | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite |
| Backend API | Python, FastAPI |
| Data storage | SQLite |
| Machine learning | scikit-learn, Isolation Forest |
| Testing | pytest |

## Repository structure

\`\`\`text
INKPRINT/
├── frontend/
│   └── src/
│       ├── api/          # Backend API client
│       ├── ml/           # Frontend feature analysis and insights
│       ├── tracking/     # Event, snapshot, and progress tracking
│       └── App.tsx       # Main application flow
├── backend/
│   ├── app/
│   │   ├── ml/           # Isolation Forest training and scoring
│   │   ├── pipeline/     # Behavioral feature extraction
│   │   ├── routers/      # Session API routes
│   │   ├── db.py         # SQLite setup
│   │   ├── main.py       # FastAPI application
│   │   └── schemas.py    # Request and event schemas
│   ├── tests/
│   ├── requirements.txt
│   └── train_model.py
└── README.md
\`\`\`

## Run locally

You need **Node.js/npm** and **Python** installed.

### 1. Start the backend

From the repository root:

\`\`\`bash
cd backend
python -m venv .venv
\`\`\`

Activate the virtual environment:

**Windows PowerShell**
\`\`\`powershell
.\\.venv\\Scripts\\Activate.ps1
\`\`\`

**macOS/Linux**
\`\`\`bash
source .venv/bin/activate
\`\`\`

Install dependencies and start the API:

\`\`\`bash
pip install -r requirements.txt
uvicorn app.main:app --reload
\`\`\`

The API runs at \`http://127.0.0.1:8000\`. You can check it at \`http://127.0.0.1:8000/health\`.

### 2. Start the frontend

Open a second terminal from the repository root:

\`\`\`bash
cd frontend
npm install
npm run dev
\`\`\`

Vite is configured to use port **5555**, so the development app is available at \`http://localhost:5555\`.

The frontend API client defaults to \`http://localhost:8000\`. To use another backend address, set \`VITE_API_BASE_URL\` in the frontend environment.

## Backend API

The current API exposes these routes:

| Method | Route | Purpose |
| --- | --- | --- |
| GET | \`/health\` | Health check |
| POST | \`/sessions\` | Create a session |
| POST | \`/sessions/{session_id}/events\` | Store session events |
| POST | \`/sessions/{session_id}/snapshots\` | Store snapshot metadata |
| POST | \`/sessions/{session_id}/end\` | Mark a session as completed |
| GET | \`/sessions/{session_id}\` | Retrieve a stored session |

The SQLite database is created at \`backend/inkprint.db\` when the backend starts.

## Machine-learning component

The backend includes an Isolation Forest pipeline for anomaly-oriented analysis of completed writing sessions.

- Completed sessions stored in SQLite are used as the baseline source.
- At least **10 completed baseline sessions** are required before training.
- The model uses the canonical feature order defined in \`backend/app/pipeline/features.py\`.
- Training produces a model artifact and metadata under \`backend/artifacts/\`.
- The scoring implementation uses the Isolation Forest decision function.

From the \`backend\` directory, run:

\`\`\`bash
python train_model.py
\`\`\`

If the baseline contains fewer than 10 completed sessions, training exits with an insufficient-baseline result instead of creating a model.

An anomaly score is a statistical signal. It does not establish misconduct, authorship, AI use, or a writer's skill level.

## Tests

Backend tests use pytest. From the \`backend\` directory, run:

\`\`\`bash
pytest
\`\`\`


## Future directions

- Connect the backend ML analysis to the application through a clearly explained user-facing workflow.
- Improve baseline collection and model evaluation using consent-based, representative session data.
- Expand progress views and make recommendations easier to interpret.
- Strengthen privacy controls and session-data management.

---

Built as an evolving project exploring writing-process analytics, explainable insights, and applied machine learning.
