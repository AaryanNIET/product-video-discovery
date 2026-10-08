import { NormalizedCandidate, Platform, ProviderSearchResult } from "../../types";

/**
 * Common interface every video source must implement. Keeping this interface
 * narrow lets InstagramProvider / MetaAdsProvider / a future TikTokProvider be
 * swapped independently (and lets a live adapter replace a mock adapter without
 * touching any calling code).
 */
export interface VideoProvider {
  readonly platform: Platform;
  search(queries: string[], minimumResults: number): Promise<ProviderSearchResult>;
}

export function emptyResult(platform: Platform, requestedMinimum: number, error?: string): ProviderSearchResult {
  return {
    platform,
    candidates: [],
    status: error ? "failed" : "ok",
    error,
    requestedMinimum,
    returned: 0,
  };
}

export function partitionResult(
  platform: Platform,
  candidates: NormalizedCandidate[],
  requestedMinimum: number
): ProviderSearchResult {
  return {
    platform,
    candidates,
    status: candidates.length >= requestedMinimum ? "ok" : "partial",
    requestedMinimum,
    returned: candidates.length,
  };
}
