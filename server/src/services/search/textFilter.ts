import { NormalizedCandidate, ProductIdentity } from "../../types";

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenOverlapScore(haystack: string, needles: string[]): number {
  if (!needles.length) return 0;
  const hay = normalize(haystack);
  if (!hay) return 0;
  const hits = needles.filter((n) => n && hay.includes(normalize(n)));
  return hits.length / needles.length;
}

/**
 * Cheap, deterministic text-based relevance score (0-100) used to cull obvious
 * mismatches BEFORE spending AI vision calls. Combines brand/model/SKU match
 * with title/caption keyword overlap and category/color hints.
 */
export function scoreTextMatch(candidate: NormalizedCandidate, identity: ProductIdentity): number {
  const text = `${candidate.title || ""} ${candidate.caption || ""}`;
  const normalizedText = normalize(text);

  let score = 0;

  if (identity.brand !== "unknown" && normalizedText.includes(normalize(identity.brand))) {
    score += 35;
  }
  if (identity.productName !== "unknown" && normalizedText.includes(normalize(identity.productName))) {
    score += 30;
  }
  if (identity.sku !== "unknown" && normalizedText.includes(normalize(identity.sku))) {
    score += 15;
  }
  if (identity.category !== "unknown" && normalizedText.includes(normalize(identity.category))) {
    score += 10;
  }
  if (identity.color !== "unknown" && normalizedText.includes(normalize(identity.color))) {
    score += 5;
  }

  score += tokenOverlapScore(text, identity.visualFeatures) * 10;

  // Negative-term penalty (explicitly known mismatches, e.g. a different model line).
  for (const neg of identity.negativeTerms) {
    if (neg && normalizedText.includes(normalize(neg))) score -= 25;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export const TEXT_FILTER_THRESHOLD = 20; // candidates below this never reach vision AI
