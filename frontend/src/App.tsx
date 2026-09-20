
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import "./App.css";

import type {
  SessionPayload,
  WritingEvent,
} from "./types";

import {
  createSession,
  endSession,
  sendEvents,
  sendSnapshots,
} from "./api/client";

import { createEvent } from "./tracking/eventTracker";

import {
  createSnapshot,
  type WritingSnapshot,
} from "./tracking/snapshotTracker";

import { extractFeatures } from "./ml/featureExtractor";
import { predictBehavior } from "./ml/decisionEngine";
import {
  analyzeSession,
  type SessionIntelligence,
} from "./ml/skillIntelligence";
import {
  buildSkillTrends,
  compareMetric,
  loadSessionHistory,
  previousMetrics,
  saveSessionMetrics,
  type HistoricalSession,
} from "./tracking/progressTracker";

function currentTimestamp() {
  return Date.now();
}

function App() {
  const sessionId = useRef<string | null>(null);
  const sessionStartedAt = useRef<number | null>(null);

  const pastePending = useRef(false);

  const eventsRef = useRef<WritingEvent[]>([]);
  const snapshotsRef = useRef<WritingSnapshot[]>([]);

  const isSubmittingSessionRef =
    useRef(false);

  const isStartingSessionRef =
    useRef(false);

  /*
   * Keeps the latest editor text available
   * to timers without restarting the timers.
   */
  const textRef = useRef("");

  /*
   * Stores the last time the document changed.
   */
  const lastChangeTime =
    useRef<number | null>(null);

  /*
   * Prevents repeated pause events.
   */
  const pauseRecorded =
    useRef(false);

  const [isWriting, setIsWriting] =
    useState(false);

  const [behaviorPrediction, setBehaviorPrediction] =
    useState<
      ReturnType<typeof predictBehavior> | null
    >(null);

  const [sessionIntelligence, setSessionIntelligence] =
    useState<SessionIntelligence | null>(null);

  const [sessionHistory, setSessionHistory] =
    useState<HistoricalSession[]>(() => loadSessionHistory());

  const [isStartingSession, setIsStartingSession] =
    useState(false);

  const [isSubmittingSession, setIsSubmittingSession] =
    useState(false);

  const [sessionMessage, setSessionMessage] =
    useState<string | null>(null);

  const [text, setText] = useState("");

  const [seconds, setSeconds] = useState(0);

  const [pasteCount, setPasteCount] =
    useState(0);

  const [events, setEvents] =
    useState<WritingEvent[]>([]);

  const [snapshots, setSnapshots] =
    useState<WritingSnapshot[]>([]);

  /*
   * Add a writing event
   */
  const addEvent = (
    event: Omit<
      WritingEvent,
      "id" | "timestamp"
    >
  ) => {
    const newEvent = createEvent(event);

    eventsRef.current = [
      ...eventsRef.current,
      newEvent,
    ];

    setEvents([...eventsRef.current]);
  };

  /*
   * Save a document snapshot
   *
   * This function reads the latest text
   * directly from textRef.
   */
  const saveSnapshot = useCallback(() => {
    if (!isWriting) {
      return;
    }

    const currentText = textRef.current;

    if (currentText.length === 0) {
      return;
    }

    const snapshot =
      createSnapshot(currentText);

    snapshotsRef.current = [
      ...snapshotsRef.current,
      snapshot,
    ];

    setSnapshots([
      ...snapshotsRef.current,
    ]);
  }, [isWriting]);

  /*
   * Session timer
   */
  useEffect(() => {
    if (!isWriting) {
      return;
    }

    const timer = setInterval(() => {
      setSeconds(
        (previous) => previous + 1
      );
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [isWriting]);

  /*
   * Automatic snapshots
   *
   * Every 5 seconds while writing.
   */
  useEffect(() => {
    if (!isWriting) {
      return;
    }

    const snapshotTimer =
      setInterval(() => {
        saveSnapshot();
      }, 5000);

    return () => {
      clearInterval(snapshotTimer);
    };
  }, [isWriting, saveSnapshot]);

  /*
   * Pause detection
   *
   * A pause is recorded after 3 seconds
   * without a document change.
   */
  useEffect(() => {
    if (!isWriting) {
      return;
    }

    const pauseChecker =
      setInterval(() => {
        if (!lastChangeTime.current) {
          return;
        }

        const timeSinceChange =
          Date.now() -
          lastChangeTime.current;

        const pauseThreshold = 3000;

        if (
          timeSinceChange >=
            pauseThreshold &&
          !pauseRecorded.current
        ) {
          addEvent({
            type: "pause",
            contentLength:
              textRef.current.length,
          });

          pauseRecorded.current = true;
        }
      }, 1000);

    return () => {
      clearInterval(pauseChecker);
    };
  }, [isWriting]);

  /*
   * Start session
   */
  const handleStart = async () => {
    if (
      isStartingSessionRef.current ||
      isSubmittingSessionRef.current
    ) {
      return;
    }

    const startedAt = Date.now();

    const clientSessionId =
      crypto.randomUUID();

    isStartingSessionRef.current =
      true;

    setIsStartingSession(true);
    setSessionMessage(null);

    try {
      const createdSession =
        await createSession(
          clientSessionId,
          startedAt
        );

      sessionId.current =
        createdSession.session_id;

      sessionStartedAt.current =
        createdSession.started_at;

      pastePending.current = false;

      setSeconds(0);
      setPasteCount(0);

      textRef.current = "";
      setText("");

      setBehaviorPrediction(null);
      setSessionIntelligence(null);

      eventsRef.current = [];
      setEvents([]);

      snapshotsRef.current = [];
      setSnapshots([]);

      lastChangeTime.current =
        Date.now();

      pauseRecorded.current = false;

      const startEvent: WritingEvent = {
        id: crypto.randomUUID(),
        type: "session_started",
        timestamp:
          createdSession.started_at,
        contentLength: 0,
      };

      eventsRef.current = [
        startEvent,
      ];

      setEvents([
        startEvent,
      ]);

      setIsWriting(true);
    } catch {
      sessionId.current = null;
      sessionStartedAt.current = null;

      setSessionMessage(
        "Unable to start a session. Please check that the InkPrint backend is running."
      );
    } finally {
      isStartingSessionRef.current =
        false;

      setIsStartingSession(false);
    }
  };

  /*
   * End session
   */
  const handleStop = async () => {
    if (
      !isWriting ||
      isSubmittingSessionRef.current
    ) {
      return;
    }

    /*
     * Save a final snapshot before
     * ending the session.
     */
    const currentText = textRef.current;

    if (currentText.length > 0) {
      const finalSnapshot =
        createSnapshot(currentText);

      snapshotsRef.current = [
        ...snapshotsRef.current,
        finalSnapshot,
      ];

      setSnapshots([
        ...snapshotsRef.current,
      ]);
    }

    /*
     * Capture a final pause if necessary.
     */
    if (
      lastChangeTime.current &&
      currentTimestamp() -
        lastChangeTime.current >=
        3000 &&
      !pauseRecorded.current
    ) {
      const finalPauseEvent =
        createEvent({
          type: "pause",
          contentLength:
            currentText.length,
        });

      eventsRef.current = [
        ...eventsRef.current,
        finalPauseEvent,
      ];

      pauseRecorded.current = true;
    }

    const endedAt = currentTimestamp();

    const activeSessionId =
      sessionId.current;

    if (!activeSessionId) {
      setSessionMessage(
        "Unable to save this session. Please check that the InkPrint backend is running."
      );

      return;
    }

    const startedAt =
      sessionStartedAt.current ??
      endedAt;

    const endEvent: WritingEvent = {
      id: crypto.randomUUID(),
      type: "session_ended",
      timestamp: endedAt,
      contentLength:
        currentText.length,
    };

    const finalEvents = [
      ...eventsRef.current,
      endEvent,
    ];

    const sessionPayload: SessionPayload = {
      sessionId:
        activeSessionId,

      startedAt,

      endedAt,

      events:
        finalEvents,

      snapshots:
        snapshotsRef.current,

      finalContentLength:
        currentText.length,

      duration:
        endedAt - startedAt,
    };

    eventsRef.current =
      finalEvents;

    setEvents([
      ...finalEvents,
    ]);

    isSubmittingSessionRef.current =
      true;

    setIsSubmittingSession(true);

    setSessionMessage(null);

    setIsWriting(false);

    try {
      /*
       * Save events
       */
      await sendEvents(
        sessionPayload.sessionId,
        sessionPayload.events
      );

      /*
       * Save snapshots
       */
      await sendSnapshots(
        sessionPayload.sessionId,
        sessionPayload.snapshots
      );

      /*
       * End backend session
       */
      await endSession(
        sessionPayload.sessionId,
        sessionPayload.endedAt,
        sessionPayload.finalContentLength,
        sessionPayload.duration
      );

      /*
       * AI / ML behavior analysis
       */
      const features =
        extractFeatures(
          sessionPayload.events
        );

      const prediction =
        predictBehavior(features);

      const intelligence = analyzeSession(
        features,
        wordCount,
        sessionPayload.duration
      );

      const updatedHistory = saveSessionMetrics(
        activeSessionId,
        intelligence.metrics
      );

      setBehaviorPrediction(
        prediction
      );

      setSessionIntelligence(intelligence);
      setSessionHistory(updatedHistory);

      setSessionMessage(
        "Session saved successfully."
      );
    } catch {
      setSessionMessage(
        "Unable to save this session. Please check that the InkPrint backend is running."
      );
    } finally {
      isSubmittingSessionRef.current =
        false;

      setIsSubmittingSession(false);
    }
  };

  /*
   * Handle normal editor changes
   */
  const handleTextChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    const newText =
      event.target.value;

    if (isWriting) {
      const difference =
        newText.length -
        textRef.current.length;

      const isPasteChange =
        pastePending.current;

      pastePending.current =
        false;

      /*
       * User inserted characters
       */
      if (
        difference > 0 &&
        !isPasteChange
      ) {
        addEvent({
          type: "typing",
          insertedLength:
            difference,
          cursorPosition:
            event.target.selectionStart,
          contentLength:
            newText.length,
        });
      }

      /*
       * User deleted characters
       */
      if (difference < 0) {
        addEvent({
          type: "delete",
          deletedLength:
            Math.abs(difference),
          cursorPosition:
            event.target.selectionStart,
          contentLength:
            newText.length,
        });
      }

      /*
       * Document changed.
       */
      lastChangeTime.current =
        Date.now();

      /*
       * Allow another pause.
       */
      pauseRecorded.current =
        false;
    }

    /*
     * Keep ref and React state
     * synchronized.
     */
    textRef.current = newText;

    setText(newText);
  };

  /*
   * Handle paste
   */
  const handlePaste = (
    event: React.ClipboardEvent<HTMLTextAreaElement>
  ) => {
    if (!isWriting) {
      return;
    }

    const pastedText =
      event.clipboardData.getData(
        "text"
      );

    pastePending.current =
      pastedText.length > 0;

    setPasteCount(
      (previous) =>
        previous + 1
    );

    addEvent({
      type: "paste",
      insertedLength:
        pastedText.length,
      cursorPosition:
        event.currentTarget
          .selectionStart,
      contentLength:
        textRef.current.length -
        (
          event.currentTarget
            .selectionEnd -
          event.currentTarget
            .selectionStart
        ) +
        pastedText.length,
    });

    lastChangeTime.current =
      Date.now();

    pauseRecorded.current =
      false;
  };

  /*
   * Word count
   */
  const wordCount =
    text.trim()
      ? text
          .trim()
          .split(/\s+/)
          .length
      : 0;

  /*
   * Character count
   */
  const characterCount =
    text.length;

  /*
   * Format session time
   */
  const formatTime = (
    totalSeconds: number
  ) => {
    const minutes =
      Math.floor(
        totalSeconds / 60
      )
        .toString()
        .padStart(2, "0");

    const remainingSeconds =
      (
        totalSeconds % 60
      )
        .toString()
        .padStart(2, "0");

    return `${minutes}:${remainingSeconds}`;
  };

  /*
   * Format event timestamp
   */
  const formatEventTime = (
    timestamp: number
  ) => {
    return new Date(
      timestamp
    ).toLocaleTimeString();
  };

  const previousSessionMetrics =
    sessionIntelligence && sessionHistory.length > 1
      ? sessionHistory[sessionHistory.length - 2].metrics
      : sessionIntelligence
        ? null
        : previousMetrics(sessionHistory);

  const fluencyComparison = sessionIntelligence &&
    previousSessionMetrics
    ? compareMetric(
        sessionIntelligence.metrics.skillScores["Writing Fluency"],
        previousSessionMetrics.skillScores["Writing Fluency"]
      )
    : null;

  const pauseComparison = sessionIntelligence &&
    previousSessionMetrics
    ? compareMetric(
        sessionIntelligence.metrics.pauseCount,
        previousSessionMetrics.pauseCount
      )
    : null;

  const skillTrends = buildSkillTrends(sessionHistory);

  const strongestSkill = sessionIntelligence
    ? [...sessionIntelligence.metrics.skillProfile].sort((left, right) => right.score - left.score)[0]
    : null;

  const focusSkill = sessionIntelligence
    ? [...sessionIntelligence.metrics.skillProfile].sort((left, right) => left.score - right.score)[0]
    : null;

  const focusInsight = sessionIntelligence?.insights.find(
    (insight) => insight.possibleSkillArea === focusSkill?.name ||
      (focusSkill?.name === "Planning / Organization" && insight.possibleSkillArea === "Planning & Organization")
  );

  return (
    <div className="app">

      {/* HEADER */}

      <header className="topbar">

        <div className="brand">

          <div className="logo">
            I
          </div>

          <div>
            <h1>
              InkPrint
            </h1>

            <span>
              Writing Intelligence
            </span>
          </div>

        </div>

        <div className="session-status">

          <span
            className={
              isWriting
                ? "status-dot active"
                : "status-dot"
            }
          />

          {isWriting
            ? "Session active"
            : "Session inactive"}

        </div>

      </header>

      {/* MAIN */}

      <main className="main-content">

        {/* ASSIGNMENT */}

        <section className="assignment-header">

          <div>

            <p className="eyebrow">
              WRITING SESSION
            </p>

            <h2>
              Climate Change &
              Sustainability
            </h2>

            <p className="description">
              Write your response
              naturally. InkPrint
              records the writing
              process during this
              session.
            </p>

            <p className="consent-note">
              Opt-in analysis • Session-based data • Anonymized learner records
            </p>

            {sessionMessage && (
              <p role="status">
                {sessionMessage}
              </p>
            )}

          </div>

          {!isWriting ? (

            <button
              className="start-button"
              onClick={handleStart}
              disabled={
                isStartingSession ||
                isSubmittingSession
              }
            >
              {isStartingSession
                ? "Starting session..."
                : "Start Session"}
            </button>

          ) : (

            <button
              className="stop-button"
              onClick={handleStop}
              disabled={
                isSubmittingSession
              }
            >
              {isSubmittingSession
                ? "Saving session..."
                : "Stop Session"}
            </button>

          )}

        </section>

        {/* EDITOR */}

        <section className="editor-card">

          <div className="editor-toolbar">

            <span>
              Assignment Response
            </span>

            <div className="live-indicator">

              <span
                className={
                  isWriting
                    ? "pulse"
                    : ""
                }
              />

              {isWriting
                ? "Recording"
                : "Not recording"}

            </div>

          </div>

          <textarea
            value={text}
            onChange={
              handleTextChange
            }
            onPaste={
              handlePaste
            }
            disabled={!isWriting}
            placeholder={
              isWriting
                ? "Start writing your response here..."
                : "Start a session to begin writing..."
            }
          />

          {/* FOOTER */}

          <div className="editor-footer">

            <div className="stats">

              <span>
                <strong>
                  {wordCount}
                </strong>{" "}
                words
              </span>

              <span>
                <strong>
                  {characterCount}
                </strong>{" "}
                characters
              </span>

              <span>
                <strong>
                  {formatTime(
                    seconds
                  )}
                </strong>{" "}
                time
              </span>

              <span>
                <strong>
                  {pasteCount}
                </strong>{" "}
                pastes
              </span>

            </div>

            <span className="privacy-note">
              Session behavior is analyzed for learning improvement.
            </span>

          </div>

        </section>

        {/* INFO CARDS */}

        <section className="info-grid">

          <div className="info-card">

            <span className="info-icon">
              ✍️
            </span>

            <div>

              <h3>
                Writing Process
              </h3>

              <p>
                InkPrint observes
                how your document
                develops over time.
              </p>

            </div>

          </div>

          <div className="info-card">

            <span className="info-icon">
              📋
            </span>

            <div>

              <h3>
                Evidence
              </h3>

              <p>
                Events such as
                insertions, pauses
                and revisions become
                part of the session
                timeline.
              </p>

            </div>

          </div>

          <div className="info-card">

            <span className="info-icon">
              👤
            </span>

            <div>

              <h3>
                Human Review
              </h3>

              <p>
                InkPrint provides
                evidence for review,
                not an automatic
                accusation.
              </p>

            </div>

          </div>

        </section>

        {/* AI BEHAVIOR ANALYSIS */}

        {behaviorPrediction && (
          <section className="behavior-analysis">

            <div className="event-debug-header">

              <div>

                <p className="eyebrow">
                  BEHAVIOR SUMMARY
                </p>

                <h3>
                  Writing Behavior
                </h3>

              </div>

              <span className="event-count">
                {(
                  behaviorPrediction
                    .confidence * 100
                ).toFixed(0)}
                % confidence
              </span>

            </div>

            <div className="behavior-result">

              <strong>
                {
                  behaviorPrediction
                    .state
                }
              </strong>

              <p>
                {
                  behaviorPrediction
                    .recommendation
                }
              </p>

              {behaviorPrediction
                .reasons.length > 0 && (
                <ul>
                  {behaviorPrediction
                    .reasons
                    .map(
                      (reason) => (
                        <li
                          key={reason}
                        >
                          {reason}
                        </li>
                      )
                    )}
                </ul>
              )}

            </div>

          </section>
        )}

        {sessionIntelligence && (
          <>
            <section className="intelligence-flow">
              <div className="event-debug-header">
                <div>
                  <p className="eyebrow">FLAGSHIP WORKFLOW</p>
                  <h3>Behavior to measurable improvement</h3>
                </div>
                <span className="event-count">Session evidence</span>
              </div>

              <div className="flow-steps">
                <div className="flow-step">
                  <span>01</span>
                  <strong>Pause + revision pattern</strong>
                  <small>{sessionIntelligence.metrics.pauseCount} pauses · {Math.round(sessionIntelligence.metrics.revisionRate * 100)}% revision rate</small>
                </div>
                <div className="flow-arrow">→</div>
                <div className="flow-step">
                  <span>02</span>
                  <strong>Behavioral feature detection</strong>
                  <small>{sessionIntelligence.metrics.wordCount} words · {Math.round(sessionIntelligence.metrics.pastePercentage * 100)}% pasted</small>
                </div>
                <div className="flow-arrow">→</div>
                <div className="flow-step">
                  <span>03</span>
                  <strong>Explainable skill insight</strong>
                  <small>{sessionIntelligence.insights.length} pattern{sessionIntelligence.insights.length === 1 ? "" : "s"} identified</small>
                </div>
                <div className="flow-arrow">→</div>
                <div className="flow-step">
                  <span>04</span>
                  <strong>Personalized action</strong>
                  <small>{sessionIntelligence.recommendations.length} targeted recommendation{sessionIntelligence.recommendations.length === 1 ? "" : "s"}</small>
                </div>
              </div>
            </section>

            <section className="summary-card">
              <div className="event-debug-header">
                <div>
                  <p className="eyebrow">FINAL LEARNING SUMMARY</p>
                  <h3>Your Writing Intelligence Summary</h3>
                </div>
                <span className="event-count">Evidence-based</span>
              </div>
              <div className="summary-grid">
                <div>
                  <span>Strength</span>
                  <strong>{strongestSkill?.name} — {strongestSkill?.score}/100</strong>
                  <small>{strongestSkill?.status} learning signal from this session.</small>
                </div>
                <div>
                  <span>Focus area</span>
                  <strong>{focusSkill?.name} — {focusSkill?.score}/100</strong>
                  <small>{focusSkill?.status} learning signal for a possible next focus.</small>
                </div>
                <div>
                  <span>Evidence</span>
                  <strong>{focusInsight?.detectedPattern ?? "No elevated pattern detected"}</strong>
                  <small>{focusInsight?.explanation ?? "The session did not produce a specific skill signal."}</small>
                </div>
                <div>
                  <span>Next action</span>
                  <strong>{focusInsight?.recommendation ?? "Continue with the current writing approach."}</strong>
                  <small>{sessionHistory.length < 2 ? "Baseline established. Complete another session to see progress." : "Compare your next session with your personal baseline."}</small>
                </div>
              </div>
            </section>

            <section className="skill-profile-section">
              <div className="event-debug-header">
                <div>
                  <p className="eyebrow">WRITING SKILL PROFILE</p>
                  <h3>Measurable learning signals</h3>
                </div>
                <span className="event-count">0–100 scale</span>
              </div>
              <div className="skill-profile-grid">
                {sessionIntelligence.metrics.skillProfile.map((skill) => {
                  const comparison = previousSessionMetrics
                    ? compareMetric(skill.score, previousSessionMetrics.skillScores[skill.name])
                    : null;
                  return (
                    <article className="skill-profile-card" key={skill.name}>
                      <div className="skill-profile-topline">
                        <span>{skill.name}</span>
                        <b>{skill.score}/100</b>
                      </div>
                      <div className="score-track"><i style={{ width: `${skill.score}%` }} /></div>
                      <div className="skill-profile-status"><strong>{skill.status}</strong><small>{comparison ? `${comparison.changePercent >= 0 ? "+" : ""}${Math.round(comparison.changePercent)}% vs previous session` : "Baseline established"}</small></div>
                      <p>{skill.explanation}</p>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="skill-insights">
              <div className="event-debug-header">
                <div>
                  <p className="eyebrow">EVIDENCE → SKILL INTELLIGENCE</p>
                  <h3>Possible skill areas</h3>
                </div>
                <span className="event-count">No definitive claims</span>
              </div>

              {sessionIntelligence.insights.length === 0 ? (
                <div className="empty-insight">
                  <strong>No elevated pattern detected</strong>
                  <p>Keep writing naturally. This session does not suggest a specific skill area for follow-up.</p>
                </div>
              ) : (
                <div className="insight-list">
                  {sessionIntelligence.insights.map((insight) => (
                    <article className="insight-card" key={`${insight.possibleSkillArea}-${insight.detectedPattern}`}>
                      <div className="insight-heading">
                        <span className="insight-label">{insight.isSkillGap ? "Possible indicator" : "Context signal"}</span>
                        <h4>{insight.possibleSkillArea}</h4>
                      </div>
                      <dl>
                        <div><dt>Observation</dt><dd>{insight.observation}</dd></div>
                        <div><dt>Detected pattern</dt><dd>{insight.detectedPattern}</dd></div>
                        <div><dt>Explanation</dt><dd>{insight.explanation}</dd></div>
                        <div><dt>Recommendation</dt><dd>{insight.recommendation}</dd></div>
                      </dl>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="progress-section">
              <div className="event-debug-header">
                <div>
                  <p className="eyebrow">PERSONAL BASELINE</p>
                  <h3>Your progress over time</h3>
                </div>
                <span className="event-count">{sessionHistory.length} saved session{sessionHistory.length === 1 ? "" : "s"}</span>
              </div>
              <div className="metric-grid">
                <div className="metric-card"><span>Writing Fluency</span><strong>{fluencyComparison ? `${Math.round(fluencyComparison.previous)} → ${Math.round(fluencyComparison.current)}` : Math.round(sessionIntelligence.metrics.skillScores["Writing Fluency"])}</strong><small>{fluencyComparison ? `${fluencyComparison.changePercent >= 0 ? "+" : ""}${Math.round(fluencyComparison.changePercent)}% vs previous session` : "Baseline starts with this session"}</small></div>
                <div className="metric-card"><span>Words per minute</span><strong>{Math.round(sessionIntelligence.metrics.wordsPerMinute)}</strong><small>{Math.round(sessionIntelligence.metrics.wordCount)} words in {Math.round(sessionIntelligence.metrics.writingDurationMs / 1000)}s</small></div>
                <div className="metric-card"><span>Long-pause frequency</span><strong>{sessionIntelligence.metrics.pauseCount}</strong><small>{pauseComparison ? `${Math.round(Math.abs(pauseComparison.changePercent))}% ${pauseComparison.changePercent <= 0 ? "decrease" : "increase"} vs previous session` : "Baseline starts with this session"}</small></div>
                <div className="metric-card"><span>Revision rate</span><strong>{Math.round(sessionIntelligence.metrics.revisionRate * 100)}%</strong><small>Deletion events as a share of edits</small></div>
                <div className="metric-card"><span>Average pause</span><strong>{(sessionIntelligence.metrics.averagePauseDurationMs / 1000).toFixed(1)}s</strong><small>Observed pause duration</small></div>
                <div className="metric-card"><span>Paste percentage</span><strong>{Math.round(sessionIntelligence.metrics.pastePercentage * 100)}%</strong><small>Of added characters</small></div>
              </div>
              <div className="metric-groups">
                <div><h4>Writing Activity</h4><p>{Math.round(sessionIntelligence.metrics.wordsPerMinute)} WPM · {Math.round(sessionIntelligence.metrics.writingDurationMs / 1000)}s writing duration · {sessionIntelligence.metrics.wordCount} final words</p></div>
                <div><h4>Revision Behavior</h4><p>{Math.round(sessionIntelligence.metrics.revisionRate * 100)}% revision rate · {Math.round(sessionIntelligence.metrics.deletionRate * 100)}% deletion rate · {sessionIntelligence.metrics.revisionCount} revision events</p></div>
                <div><h4>Writing Process</h4><p>{(sessionIntelligence.metrics.averagePauseDurationMs / 1000).toFixed(1)}s average pause · {sessionIntelligence.metrics.longPauseCount} long pauses · {Math.round(sessionIntelligence.metrics.pastePercentage * 100)}% pasted</p></div>
              </div>
            </section>

            <section className="trend-section">
              <div className="event-debug-header">
                <div>
                  <p className="eyebrow">SESSION-TO-SESSION TREND</p>
                  <h3>Your actual saved sessions</h3>
                </div>
                <span className="event-count">No peer ranking</span>
              </div>
              {sessionHistory.length < 2 ? (
                <div className="empty-insight"><strong>Complete 2 or more sessions to unlock skill trends.</strong><p>Only your saved learner sessions are used here. No historical sessions are fabricated.</p></div>
              ) : (
                <div className="trend-table">
                  <div className="trend-row trend-header"><span>Skill</span><span>Sessions</span><span>Trend</span></div>
                  {skillTrends.map((trend) => (
                    <div className="trend-row" key={trend.name}>
                      <strong>{trend.name}</strong>
                      <span>{trend.points.map((point) => `${point.scores[trend.name] ?? "—"}`).join(" → ")}</span>
                      <b className={`trend-${trend.direction.toLowerCase().replace(" ", "-")}`}>{trend.direction}</b>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="recommendation-section">
              <div className="event-debug-header">
                <div>
                  <p className="eyebrow">PERSONALIZED ACTION</p>
                  <h3>Two useful next steps</h3>
                </div>
              </div>
              {sessionIntelligence.recommendations.length === 0 ? (
                <p className="recommendation-empty">Your current pattern is steady. Keep the same approach and review your next session against this baseline.</p>
              ) : (
                <div className="recommendation-list">
                  {sessionIntelligence.recommendations.map((recommendation) => (
                    <div className="recommendation-card" key={recommendation.weakness}>
                      <span>Targeted practice</span>
                      <strong>{recommendation.weakness}</strong>
                      <p>{recommendation.action}</p>
                      <small className="practice-line">Practice: {recommendation.practice}</small>
                      <small>{recommendation.target}</small>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        <section className="aggregate-dashboard">
          <div className="event-debug-header">
            <div>
              <p className="eyebrow">TEACHER VIEW · DEMO DATA</p>
              <h3>Class Writing Insights</h3>
            </div>
            <span className="event-count">Aggregate / anonymized</span>
          </div>
          <p className="aggregate-note">Illustrative cohort summary for the prototype. It is not connected to individual learner records.</p>
          <div className="aggregate-grid">
            <div><strong>40</strong><span>demo learners represented</span></div>
            <div><strong>72/100</strong><span>average writing fluency</span></div>
            <div><strong>+14%</strong><span>overall improvement trend</span></div>
            <div><strong>24%</strong><span>high revision frequency</span></div>
            <div><strong>60%</strong><span>organization-related support signal</span></div>
            <div><strong>16%</strong><span>low writing consistency signal</span></div>
          </div>
          <div className="skill-distribution">
            <span>Common patterns</span>
            <div className="distribution-row"><label>Planning &amp; Organization</label><div><i style={{ width: "60%" }} /></div><b>60%</b></div>
            <div className="distribution-row"><label>Vocabulary / Word Choice</label><div><i style={{ width: "24%" }} /></div><b>24%</b></div>
            <div className="distribution-row"><label>Engagement consistency</label><div><i style={{ width: "16%" }} /></div><b>16%</b></div>
          </div>
          <p className="aggregate-footnote">Aggregate information is used for instructional planning only. Individual learner records are not shown or ranked here.</p>
        </section>

        <section className="privacy-panel">
          <strong>Privacy and consent</strong>
          <span>Opt-in analysis · Session-based data · Anonymized learner records</span>
          <p>InkPrint analyzes writing-session behavior for learning improvement. Session data is sent to the configured backend for saving, and personal progress is compared only with the learner's own saved sessions. Signals are indicators, not definitive judgments.</p>
        </section>

        {/* EVENT TIMELINE */}

        <section className="event-debug">

          <div className="event-debug-header">

            <div>

              <p className="eyebrow">
                DEVELOPMENT VIEW
              </p>

              <h3>
                Live Event Timeline
              </h3>

            </div>

            <span className="event-count">
              {events.length} events
            </span>

          </div>

          {events.length === 0 ? (

            <div className="empty-events">

              <span>
                ○
              </span>

              <p>
                No writing events
                recorded yet.
              </p>

              <small>
                Start a session
                and begin writing
                to see the timeline.
              </small>

            </div>

          ) : (

            <div className="event-list">

              {events.map(
                (event) => (

                  <div
                    className="event-row"
                    key={event.id}
                  >

                    <span className="event-time">
                      {formatEventTime(
                        event.timestamp
                      )}
                    </span>

                    <span
                      className={`event-type event-${event.type}`}
                    >
                      {event.type.replace(
                        "_",
                        " "
                      )}
                    </span>

                    {event.insertedLength !==
                      undefined && (
                      <span className="event-detail">
                        +
                        {
                          event.insertedLength
                        }{" "}
                        chars
                      </span>
                    )}

                    {event.deletedLength !==
                      undefined && (
                      <span className="event-detail">
                        -
                        {
                          event.deletedLength
                        }{" "}
                        chars
                      </span>
                    )}

                    {event.contentLength !==
                      undefined && (
                      <span className="event-detail">
                        document:{" "}
                        {
                          event.contentLength
                        }
                      </span>
                    )}

                  </div>

                )
              )}

            </div>

          )}

        </section>

        {/* SNAPSHOT TIMELINE */}

        <section className="event-debug">

          <div className="event-debug-header">

            <div>

              <p className="eyebrow">
                DOCUMENT HISTORY
              </p>

              <h3>
                Snapshots
              </h3>

            </div>

            <span className="event-count">
              {snapshots.length} snapshots
            </span>

          </div>

          {snapshots.length === 0 ? (

            <div className="empty-events">

              <span>
                ○
              </span>

              <p>
                No snapshots yet.
              </p>

              <small>
                A snapshot is created
                automatically every
                5 seconds while
                writing, and a final
                snapshot is saved when
                the session ends.
              </small>

            </div>

          ) : (

            <div className="event-list">

              {snapshots.map(
                (snapshot) => (

                  <div
                    className="event-row"
                    key={snapshot.id}
                  >

                    <span className="event-time">
                      {formatEventTime(
                        snapshot.timestamp
                      )}
                    </span>

                    <span className="event-type">
                      snapshot
                    </span>

                    <span className="event-detail">
                      {
                        snapshot.wordCount
                      }{" "}
                      words
                    </span>

                    <span className="event-detail">
                      {
                        snapshot.contentLength
                      }{" "}
                      characters
                    </span>

                  </div>

                )
              )}

            </div>

          )}

        </section>

      </main>

    </div>
  );
}

export default App;