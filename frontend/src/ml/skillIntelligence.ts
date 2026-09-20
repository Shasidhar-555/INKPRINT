import type { BehavioralFeatures } from "./featureExtractor";

export type SkillArea =
  | "Planning & Organization"
  | "Vocabulary / Word Choice"
  | "Original Expression"
  | "Writing Fluency"
  | "Revision Efficiency"
  | "Writing Consistency"
  | "Engagement consistency";

export type SkillName =
  | "Writing Fluency"
  | "Original Expression"
  | "Revision Efficiency"
  | "Planning / Organization"
  | "Writing Consistency";

export type SkillStatus =
  | "Strong"
  | "Good"
  | "Moderate"
  | "Needs Improvement";

export interface SkillScore {
  name: SkillName;
  score: number;
  status: SkillStatus;
  explanation: string;
}

export interface SessionMetrics {
  wordsPerMinute: number;
  pauseCount: number;
  averagePauseDurationMs: number;
  deletionRate: number;
  revisionRate: number;
  revisionCount: number;
  deletionCount: number;
  longPauseCount: number;
  pastePercentage: number;
  wordCount: number;
  writingDurationMs: number;
  skillScores: Record<SkillName, number>;
  skillProfile: SkillScore[];
}

export interface SkillInsight {
  observation: string;
  detectedPattern: string;
  possibleSkillArea: SkillArea;
  explanation: string;
  recommendation: string;
  isSkillGap: boolean;
}

export interface PersonalizedRecommendation {
  weakness: string;
  action: string;
  practice: string;
  target: string;
}

export interface SessionIntelligence {
  metrics: SessionMetrics;
  insights: SkillInsight[];
  recommendations: PersonalizedRecommendation[];
}

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function statusForScore(score: number): SkillStatus {
  if (score >= 80) return "Strong";
  if (score >= 65) return "Good";
  if (score >= 45) return "Moderate";
  return "Needs Improvement";
}

function explanationForScore(
  name: SkillName,
  score: number,
  features: BehavioralFeatures,
  metrics: Omit<SessionMetrics, "skillScores" | "skillProfile">,
): string {
  const status = statusForScore(score).toLowerCase();
  const evidence = {
    "Writing Fluency": `${Math.round(metrics.wordsPerMinute)} words per minute and ${metrics.longPauseCount} long pause${metrics.longPauseCount === 1 ? "" : "s"}`,
    "Original Expression": `${Math.round(metrics.pastePercentage * 100)}% pasted content and ${Math.round(features.deletionRate * 100)}% deletion rate`,
    "Revision Efficiency": `${metrics.revisionCount} revision event${metrics.revisionCount === 1 ? "" : "s"} and ${Math.round(features.deletionRate * 100)}% deletion rate`,
    "Planning / Organization": `${metrics.longPauseCount} long pause${metrics.longPauseCount === 1 ? "" : "s"} averaging ${Math.round(metrics.averagePauseDurationMs / 100) / 10}s`,
    "Writing Consistency": `${features.typingEventCount} typing bursts across ${Math.round(metrics.writingDurationMs / 1000)} seconds`,
  }[name];

  return `${status[0].toUpperCase()}${status.slice(1)} learning signal based on ${evidence}. This is an observed pattern, not a definitive judgment.`;
}

function buildSkillProfile(
  features: BehavioralFeatures,
  metrics: Omit<SessionMetrics, "skillScores" | "skillProfile">,
): SkillScore[] {
  const scores: Record<SkillName, number> = {
    "Writing Fluency": clamp(
      metrics.wordsPerMinute * 1.2 - metrics.longPauseCount * 6 - metrics.averagePauseDurationMs / 250 + 35,
    ),
    "Original Expression": clamp(
      100 - metrics.pastePercentage * 80 - (metrics.pastePercentage >= 0.35 ? features.deletionRate * 20 : 0),
    ),
    "Revision Efficiency": clamp(
      100 - features.deletionRate * 75 - features.correctionRate * 35,
    ),
    "Planning / Organization": clamp(
      100 - metrics.longPauseCount * 8 - metrics.averagePauseDurationMs / 200,
    ),
    "Writing Consistency": clamp(
      100 - metrics.longPauseCount * 5 - Math.min(30, metrics.averagePauseDurationMs / 250) + (features.typingEventCount >= 5 ? 10 : 0),
    ),
  };

  return (Object.keys(scores) as SkillName[]).map((name) => ({
    name,
    score: scores[name],
    status: statusForScore(scores[name]),
    explanation: explanationForScore(name, scores[name], features, metrics),
  }));
}

export function buildSessionMetrics(
  features: BehavioralFeatures,
  wordCount: number,
  writingDurationMs: number,
): SessionMetrics {
  const activeMinutes = Math.max(writingDurationMs / 60000, 1 / 60);
  const pastePercentage = features.totalAddedChars > 0
    ? features.pasteCharacters / features.totalAddedChars
    : 0;

  const baseMetrics = {
    wordsPerMinute: wordCount / activeMinutes,
    pauseCount: features.pauseCount,
    averagePauseDurationMs: features.averagePauseMs,
    deletionRate: features.deletionRate,
    revisionRate: features.correctionRate,
    revisionCount: features.deletionEventCount,
    deletionCount: features.totalDeletedChars,
    longPauseCount: features.pauseCount,
    pastePercentage,
    wordCount,
    writingDurationMs,
  };

  const skillProfile = buildSkillProfile(features, baseMetrics);

  return {
    ...baseMetrics,
    skillScores: Object.fromEntries(skillProfile.map((skill) => [skill.name, skill.score])) as Record<SkillName, number>,
    skillProfile,
  };
}

export function mapSkillInsights(
  features: BehavioralFeatures,
  metrics: SessionMetrics,
): SkillInsight[] {
  const insights: SkillInsight[] = [];

  if (features.pauseCount > 0 && features.averagePauseMs >= 3000) {
    insights.push({
      observation: "Frequent long pauses before continuing a sentence or idea.",
      detectedPattern: `${features.pauseCount} pause${features.pauseCount === 1 ? "" : "s"}, averaging ${Math.round(features.averagePauseMs / 100) / 10}s`,
      possibleSkillArea: "Planning & Organization",
      explanation: "Frequent hesitation before developing new ideas may indicate possible difficulty organizing thoughts before writing.",
      recommendation: "Spend 60 seconds creating 3 key points before starting.",
      isSkillGap: true,
    });
  }

  if (features.deletionRate >= 0.2 && features.correctionRate >= 0.3) {
    insights.push({
      observation: "Heavy deletion and repeated rewriting were observed.",
      detectedPattern: `${Math.round(features.deletionRate * 100)}% deletion rate and ${Math.round(features.correctionRate * 100)}% revision activity`,
      possibleSkillArea: "Revision Efficiency",
      explanation: "Repeated rewrite loops may indicate possible difficulty selecting or structuring wording during the first draft.",
      recommendation: "Draft the complete idea first, then perform one focused revision pass.",
      isSkillGap: true,
    });
  }

  if (features.pasteCharacters > 0 && metrics.pastePercentage >= 0.35 && features.deletionRate >= 0.15) {
    insights.push({
      observation: "Pasted content was followed by substantial editing.",
      detectedPattern: `${Math.round(metrics.pastePercentage * 100)}% of added characters came from paste, with active deletion afterward`,
      possibleSkillArea: "Original Expression",
      explanation: "Pasting followed by heavy editing can suggest difficulty adapting an idea into an original first draft.",
      recommendation: "Write the main claim in your own words before consulting source material.",
      isSkillGap: true,
    });
  }

  if (metrics.writingDurationMs <= 180000 && metrics.wordCount <= 80 && metrics.revisionRate < 0.1) {
    insights.push({
      observation: "This was a short session with very little revision.",
      detectedPattern: `${Math.round(metrics.writingDurationMs / 1000)} seconds and ${Math.round(metrics.revisionRate * 100)}% revision activity`,
      possibleSkillArea: "Engagement consistency",
      explanation: "The session contains limited behavioral evidence for a reliable skill assessment; this is not automatically a skill weakness.",
      recommendation: "Set a 5-minute writing window and add one supporting detail before stopping.",
      isSkillGap: false,
    });
  }

  return insights;
}

export function buildRecommendations(
  insights: SkillInsight[],
): PersonalizedRecommendation[] {
  return insights.slice(0, 2).map((insight) => ({
    weakness: insight.isSkillGap
      ? `Possible ${insight.possibleSkillArea} difficulty`
      : insight.possibleSkillArea,
    action: insight.recommendation,
    practice: insight.possibleSkillArea === "Planning & Organization"
      ? "Write a 150-word response using the outline."
      : insight.possibleSkillArea === "Revision Efficiency"
        ? "Complete one 150-word draft before revising it once."
        : insight.possibleSkillArea === "Original Expression"
          ? "Write one independent claim and two supporting details."
          : "Write for five minutes and add one supporting detail.",
    target: insight.possibleSkillArea === "Planning & Organization"
      ? "Reduce long-pause frequency by 15%."
      : insight.possibleSkillArea === "Revision Efficiency"
        ? "Reduce revision rate by 15%."
        : insight.possibleSkillArea === "Original Expression"
          ? "Keep pasted content below 20% of added characters."
          : "Reach 5 minutes of focused writing.",
  }));
}

export function analyzeSession(
  features: BehavioralFeatures,
  wordCount: number,
  writingDurationMs: number,
): SessionIntelligence {
  const metrics = buildSessionMetrics(features, wordCount, writingDurationMs);
  const insights = mapSkillInsights(features, metrics);

  return {
    metrics,
    insights,
    recommendations: buildRecommendations(insights),
  };
}
