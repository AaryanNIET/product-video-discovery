import { Platform, ProviderBatch } from "../../types";

export interface ProviderSearchOptions {
  /** 0 = most specific terms; later rounds use wider terms and deeper pages. */
  round: number;
  /** Raw items wanted from this round in total (split across the terms). Scrapers bill per item. */
  limit: number;
  /** 1 for fresh terms; 2+ when terms are reused, so the scraper paginates deeper than last time. */
  depth: number;
}

/** Items to request per term so a round stays within its total budget. */
export const perTermLimit = (opts: ProviderSearchOptions, terms: string[]) => Math.max(3, Math.ceil(opts.limit / terms.length) * opts.depth);

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
