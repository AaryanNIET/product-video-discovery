export interface ProductIdentity {
  brand: string;
  productName: string;
  modelNumber: string;
  sku: string;
  category: string;
  color: string;
  imageUrl: string | null;
  visualFeatures: string[];
  searchQueries: string[];
  negativeTerms: string[];
}

export interface VerificationResult {
  sameProduct: boolean;
  confidence: number;
  brandMatch: boolean;
  modelMatch: boolean;
  visualMatch: number;
  evidence: string[];
}

export interface VideoCandidate {
  id: string;
  externalId: string;
  platform: "instagram" | "meta_ads";
  url: string;
  thumbnailUrl?: string;
  title?: string;
  caption?: string;
  creator?: string;
  sourceQuery: string;
  textScore?: number;
  visualScore?: number;
  metadataScore?: number;
  finalScore?: number;
  verification?: VerificationResult;
}

export interface SourceResult {
  candidates: VideoCandidate[];
  status: "ok" | "partial" | "failed";
  error?: string | null;
  shortfallReason?: string | null;
}

export interface DiscoveryResults {
  product: ProductIdentity;
  instagram: SourceResult;
  metaAds: SourceResult;
}

export interface ProgressStep {
  step: string;
  status: "pending" | "active" | "done" | "error";
  detail?: string;
  at: string;
}

export interface JobStatusResponse {
  jobId: string;
  status: "pending" | "processing" | "partial_success" | "completed" | "failed";
  progress: ProgressStep[];
  results: DiscoveryResults | null;
}

export interface HistoryItem {
  jobId: string;
  status: string;
  productName?: string;
  sourceInput?: string;
  instagramCount: number;
  metaAdsCount: number;
  createdAt: string;
}
