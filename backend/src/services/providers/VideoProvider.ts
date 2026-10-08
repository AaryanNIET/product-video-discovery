import { Platform, ProviderBatch } from "../../types";

export interface ProviderSearchOptions {
  /** 0 = most specific terms; later rounds use wider terms and deeper pages. */
  round: number;
  /** Rough number of raw items wanted from this round. */
  limit: number;
}

/**
 * Every video source implements this one method, so sources can be swapped,
 * mocked or added (TikTok) without touching the pipeline.
 */
export interface VideoProvider {
  readonly platform: Platform;
  /** Search terms this provider wants from the brain's plan for a given round. */
  termsFor(plan: { instagramHashtags: string[]; metaKeywords: string[]; tiktokKeywords: string[] }, round: number): string[];
  search(terms: string[], opts: ProviderSearchOptions): Promise<ProviderBatch>;
}
