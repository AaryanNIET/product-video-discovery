export type Platform = "instagram" | "meta_ads" | "tiktok";

export const PLATFORMS: Platform[] = ["instagram", "meta_ads", "tiktok"];

/** What the image brain sees in the reference product photo. */
export interface ProductAttributes {
  productType: string;
  brand: string;
  colours: string[];
  printsOrGraphics: string[];
  logos: string[];
  textOnProduct: string[];
  material: string;
  shape: string;
  distinctiveFeatures: string[];
  /** One sentence describing the exact product, used as the reference when no image exists. */
  summary: string;
}

/** Per-platform search terms derived from the attributes, ordered most specific first. */
export interface SearchPlan {
  instagramHashtags: string[];
  metaKeywords: string[];
  tiktokKeywords: string[];
}

export interface ProductIdentity {
  title: string;
  description: string;
  sourceType: "name" | "url" | "image";
  sourceUrl: string | null;
  /** Where the reference image came from; null when matching against a text description only. */
  imageSource: "page" | "upload" | null;
  /** Locally cached copy of the reference image, served by /api/media/ref/:id */
  imageId: string | null;
  /** Original remote image URL (product page), if any. */
  imageUrl: string | null;
  attributes: ProductAttributes;
  searchPlan: SearchPlan;
  /** "vision" when Gemini analysed the image; "text" when it worked from text only; "heuristic" when no AI was available. */
  analysisMode: "vision" | "text" | "heuristic";
}

export type MatchVerdict = "exact" | "very_close" | "same_category" | "different" | "unclear";

export interface MatchResult {
  score: number; // 0-100
  verdict: MatchVerdict;
  reason: string;
  matched: string[];
  mismatched: string[];
  method: "vision" | "text-fallback";
}

export interface VideoCandidate {
  /** Stable key: platform:externalId */
  key: string;
  platform: Platform;
  externalId: string;
  url: string;
  thumbnailUrl?: string;
  /** Locally cached thumbnail id, served by /api/media/thumb/:id */
  thumbId?: string;
  videoUrl?: string;
  caption?: string;
  creator?: string;
  postedAt?: string;
  engagement?: number;
  /** Same creative running under several IDs (Meta collation id), used for near-duplicate detection. */
  groupId?: string;
  sourceQuery: string;
  /** 64-bit perceptual hash of the thumbnail as hex. */
  phash?: string;
  textScore?: number;
  match?: MatchResult;
  /** Set when the video was returned in an earlier search. */
  previouslySeen?: { jobId: string; at: string };
  raw?: Record<string, unknown>;
}

export interface ProviderBatch {
  candidates: VideoCandidate[];
  /** Items the source returned that were not usable videos (photos, missing media, ...). */
  skipped: number;
}

export interface SourceSummary {
  platform: Platform;
  enabled: boolean;
  status: "pending" | "running" | "ok" | "partial" | "failed" | "disabled";
  accepted: VideoCandidate[];
  belowThreshold: VideoCandidate[];
  previouslySeen: VideoCandidate[];
  stats: {
    fetched: number;
    duplicates: number;
    previouslySeen: number;
    scored: number;
    rounds: number;
  };
  queriesUsed: string[];
  error?: string;
  shortfall?: string;
}

export type JobStatus = "queued" | "running" | "completed" | "partial" | "failed";

export interface ProgressStep {
  step: string;
  status: "pending" | "active" | "done" | "error" | "skipped";
  detail?: string;
  at: string;
}

export interface SearchRequest {
  input: string;
  imageDataUrl?: string;
  includeTikTok: boolean;
}
