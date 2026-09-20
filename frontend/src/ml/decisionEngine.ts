import type { BehavioralFeatures } from "./featureExtractor";

export type BehaviorState =
  | "focused"
  | "hesitant"
  | "struggling";

export interface BehaviorPrediction {
  state: BehaviorState;
  confidence: number;
  recommendation: string;
  reasons: string[];
}

export function predictBehavior(
  features: BehavioralFeatures
): BehaviorPrediction {
  const reasons: string[] = [];

  let hesitationScore = 0;
  let struggleScore = 0;

  // Frequent deletions indicate repeated corrections.
  if (features.deletionRate >= 0.2) {
    struggleScore += 0.35;
    reasons.push("Frequent corrections detected");
  }

  // Many deletion events relative to editing activity.
  if (features.correctionRate >= 0.3) {
    struggleScore += 0.25;
    reasons.push("High correction frequency");
  }

  // Long pauses can indicate hesitation.
  if (features.averagePauseMs >= 3000) {
    hesitationScore += 0.3;
    reasons.push("Long pauses between writing actions");
  }

  if (features.pauseCount >= 3) {
    hesitationScore += 0.2;
    reasons.push("Repeated pauses detected");
  }

  // Very slow writing can indicate difficulty.
  if (
    features.typingSpeedCharsPerMinute > 0 &&
    features.typingSpeedCharsPerMinute < 80
  ) {
    hesitationScore += 0.2;
    reasons.push("Low typing speed");
  }

  // Choose the strongest behavioral signal.
  if (struggleScore >= hesitationScore && struggleScore >= 0.4) {
    return {
      state: "struggling",
      confidence: Math.min(0.95, 0.6 + struggleScore / 2),
      recommendation:
        "Consider pausing briefly and reviewing the previous sentence before continuing.",
      reasons,
    };
  }

  if (hesitationScore >= 0.4) {
    return {
      state: "hesitant",
      confidence: Math.min(0.95, 0.6 + hesitationScore / 2),
      recommendation:
        "You may be hesitating. Try completing the current thought before editing.",
      reasons,
    };
  }

  return {
    state: "focused",
    confidence: 0.75,
    recommendation:
      "Writing flow looks consistent. Continue with the current approach.",
    reasons:
      reasons.length > 0
        ? reasons
        : ["Stable typing and correction pattern"],
  };
}