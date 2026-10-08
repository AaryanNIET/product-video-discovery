import { NormalizedCandidate } from "../../types";

/**
 * Dedupe by platform + external id (exact repost detection) and by a loose
 * normalized-caption fingerprint (catches the same ad/reel reappearing under a
 * different id, e.g. a re-upload with identical copy).
 */
export function dedupeCandidates(candidates: NormalizedCandidate[]): NormalizedCandidate[] {
  const seenIds = new Set<string>();
  const seenFingerprints = new Set<string>();
  const result: NormalizedCandidate[] = [];

  for (const c of candidates) {
    if (seenIds.has(c.id)) continue;

    const fingerprint = fingerprintOf(c);
    if (fingerprint && seenFingerprints.has(fingerprint)) continue;

    seenIds.add(c.id);
    if (fingerprint) seenFingerprints.add(fingerprint);
    result.push(c);
  }

  return result;
}

function fingerprintOf(c: NormalizedCandidate): string | null {
  const text = `${c.platform}|${c.creator || ""}|${(c.caption || c.title || "").toLowerCase().trim()}`;
  if (!c.caption && !c.title) return null;
  return text.replace(/\s+/g, " ").slice(0, 160);
}

/** Filters out candidates whose id was already returned in a previous search (uniqueness across searches). */
export function filterPreviouslySeen(candidates: NormalizedCandidate[], seenIds: Set<string>): NormalizedCandidate[] {
  return candidates.filter((c) => !seenIds.has(c.id));
}
