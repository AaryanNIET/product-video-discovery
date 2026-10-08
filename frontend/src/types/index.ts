export type Platform = "instagram" | "meta_ads" | "tiktok";

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
  summary: string;
}

export interface ProductIdentity {
  title: string;
  description: string;
  sourceType: "name" | "url" | "image";
  sourceUrl: string | null;
  imageSource: "page" | "upload" | null;
  imageId: string | null;
  imageUrl: string | null;
  attributes: ProductAttributes;
  searchPlan: { instagramHashtags: string[]; metaKeywords: string[]; tiktokKeywords: string[] };
  analysisMode: "vision" | "text" | "heuristic";
}

export type MatchVerdict = "exact" | "very_close" | "same_category" | "different" | "unclear";

export interface MatchResult {
  score: number;
  verdict: MatchVerdict;
  reason: string;
  matched: string[];
  mismatched: string[];
  method: "vision" | "text-fallback";
}

export interface VideoCandidate {
  key: string;
  platform: Platform;
  externalId: string;
  url: string;
  thumbId?: string;
  videoUrl?: string;
  caption?: string;
  creator?: string;
  postedAt?: string;
  engagement?: number;
  sourceQuery: string;
  match?: MatchResult;
  previouslySeen?: { jobId: string; at: string };
}

export interface SourceSummary {
  platform: Platform;
  enabled: boolean;
  status: "pending" | "running" | "ok" | "partial" | "failed" | "disabled";
  accepted: VideoCandidate[];
  belowThreshold: VideoCandidate[];
  previouslySeen: VideoCandidate[];
  stats: { fetched: number; duplicates: number; previouslySeen: number; scored: number; rounds: number };
  queriesUsed: string[];
  error?: string;
  shortfall?: string;
}

export interface ProgressStep {
  step: string;
  status: "pending" | "active" | "done" | "error" | "skipped";
  detail?: string;
  at: string;
}

export type JobStatus = "queued" | "running" | "completed" | "partial" | "failed";

export interface SearchJob {
  jobId: string;
  input: string;
  hasUpload: boolean;
  includeTikTok: boolean;
  status: JobStatus;
  progress: ProgressStep[];
  product: ProductIdentity | null;
  sources: Partial<Record<Platform, SourceSummary>>;
  error?: string;
  createdAt: string;
  minimumPerSource: number;
  matchThreshold: number;
}

export interface HistoryItem {
  jobId: string;
  input: string;
  hasUpload: boolean;
  status: JobStatus;
  title: string;
  imageId: string | null;
  counts: Partial<Record<Platform, number>>;
  createdAt: string;
}

export interface ShortlistItem {
  key: string;
  platform: Platform;
  url: string;
  thumbId?: string;
  caption?: string;
  creator?: string;
  score?: number;
  reason?: string;
  productTitle?: string;
  jobId?: string;
  createdAt: string;
}

export interface Health {
  ok: boolean;
  providerMode: "live" | "mock";
  database: string;
  scraper: string;
  vision: string;
  tiktokAvailable: boolean;
  matchThreshold: number;
  minimumPerSource: number;
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: "Instagram Reels",
  meta_ads: "Meta Ad Library",
  tiktok: "TikTok",
};
