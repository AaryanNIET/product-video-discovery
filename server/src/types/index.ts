export interface ProductIdentity {
  brand: string | "unknown";
  productName: string;
  modelNumber: string | "unknown";
  sku: string | "unknown";
  category: string | "unknown";
  color: string | "unknown";
  imageUrl: string | null;
  visualFeatures: string[];
  searchQueries: string[];
  negativeTerms: string[];
}

export type Platform = "instagram" | "meta_ads";

export interface NormalizedCandidate {
  id: string; // internal id (hash of platform+externalId)
  externalId: string;
  platform: Platform;
  url: string;
  thumbnailUrl?: string;
  title?: string;
  caption?: string;
  creator?: string;
  metadata: Record<string, unknown>;
  sourceQuery: string;
  textScore?: number;
  visualScore?: number;
  metadataScore?: number;
  finalScore?: number;
  verification?: VerificationResult;
  retrievedAt: string;
}

export interface VerificationResult {
  sameProduct: boolean;
  confidence: number; // 0-100
  brandMatch: boolean;
  modelMatch: boolean;
  visualMatch: number; // 0-100
  evidence: string[];
}

export interface ProviderSearchResult {
  platform: Platform;
  candidates: NormalizedCandidate[];
  status: "ok" | "partial" | "failed";
  error?: string;
  requestedMinimum: number;
  returned: number;
}

export type JobStatus = "pending" | "processing" | "partial_success" | "completed" | "failed";

export interface ProgressStep {
  step: string;
  status: "pending" | "active" | "done" | "error";
  detail?: string;
  at: string;
}
