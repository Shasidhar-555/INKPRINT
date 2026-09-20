import type {
  SessionMetrics,
  SkillName,
} from "../ml/skillIntelligence";

const HISTORY_KEY = "inkprint.session-history.v1";

export interface HistoricalSession {
  id: string;
  recordedAt: number;
  metrics: SessionMetrics;
}

export interface MetricComparison {
  current: number;
  previous: number;
  changePercent: number;
}

export interface SkillTrendPoint {
  sessionNumber: number;
  sessionId: string;
  recordedAt: number;
  scores: Partial<Record<SkillName, number>>;
}

export type TrendDirection = "Improving" | "Stable" | "Needs Attention";

export interface SkillTrend {
  name: SkillName;
  points: SkillTrendPoint[];
  direction: TrendDirection;
}

function isBrowserStorageAvailable() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadSessionHistory(): HistoricalSession[] {
  if (!isBrowserStorageAvailable()) return [];

  try {
    const stored = window.localStorage.getItem(HISTORY_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed as HistoricalSession[] : [];
  } catch {
    return [];
  }
}

export function saveSessionMetrics(
  id: string,
  metrics: SessionMetrics,
): HistoricalSession[] {
  const history = [
    ...loadSessionHistory(),
    { id, recordedAt: Date.now(), metrics },
  ].slice(-10);

  if (isBrowserStorageAvailable()) {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }

  return history;
}

export function compareMetric(
  current: number,
  previous: number | undefined,
): MetricComparison | null {
  if (previous === undefined) return null;

  return {
    current,
    previous,
    changePercent: previous === 0
      ? current === 0 ? 0 : 100
      : ((current - previous) / previous) * 100,
  };
}

export function previousMetrics(
  history: HistoricalSession[],
): SessionMetrics | null {
  return history.length > 0
    ? history[history.length - 1].metrics
    : null;
}

export function buildSkillTrends(
  history: HistoricalSession[],
): SkillTrend[] {
  const skillNames: SkillName[] = [
    "Writing Fluency",
    "Original Expression",
    "Revision Efficiency",
    "Planning / Organization",
    "Writing Consistency",
  ];

  return skillNames.map((name) => {
    const points = history.map((session, index) => ({
      sessionNumber: index + 1,
      sessionId: session.id,
      recordedAt: session.recordedAt,
      scores: { [name]: session.metrics.skillScores?.[name] },
    }));
    const first = points[0]?.scores[name];
    const last = points[points.length - 1]?.scores[name];
    const difference = first !== undefined && last !== undefined ? last - first : 0;

    return {
      name,
      points,
      direction: difference >= 5
        ? "Improving"
        : difference <= -5
          ? "Needs Attention"
          : "Stable",
    };
  });
}
