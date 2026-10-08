import { env } from "../../config/env";
import { NormalizedCandidate } from "../../types";

export interface RankWeights {
  text: number;
  visual: number;
  metadata: number;
}

/** Simple metadata signal: engagement proxy, normalized 0-100. Configurable/extensible. */
function metadataScoreOf(candidate: NormalizedCandidate): number {
  const likes = Number((candidate.metadata as any)?.likes ?? 0);
  const spend = (candidate.metadata as any)?.spendRangeUsd ? 50 : 0;
  if (likes) return Math.min(100, Math.round((likes / 50000) * 100));
  if (spend) return spend;
  return 40; // neutral default when no engagement signal is available
}

/**
 * finalScore = weightText * textScore + weightVisual * visualScore + weightMetadata * metadataScore
 * Weights are configurable via env (RANK_WEIGHT_*) and must sum to ~1.0.
 */
export function rankCandidates(
  candidates: NormalizedCandidate[],
  weights: RankWeights = env.rankWeights
): NormalizedCandidate[] {
  const scored = candidates.map((c) => {
    const metadataScore = metadataScoreOf(c);
    const textScore = c.textScore ?? 0;
    const visualScore = c.verification?.visualMatch ?? c.visualScore ?? 0;
    const finalScore = Math.round(weights.text * textScore + weights.visual * visualScore + weights.metadata * metadataScore);
    return { ...c, metadataScore, visualScore, finalScore };
  });

  return scored.sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));
}
