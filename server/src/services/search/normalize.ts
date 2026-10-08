import { NormalizedCandidate, Platform } from "../../types";

/** Deterministic internal id derived from platform + external id (stable across requests). */
export function candidateId(platform: Platform, externalId: string): string {
  return `${platform}:${externalId}`;
}

export function toNormalized(params: {
  platform: Platform;
  externalId: string;
  url: string;
  thumbnailUrl?: string;
  title?: string;
  caption?: string;
  creator?: string;
  metadata: Record<string, unknown>;
  sourceQuery: string;
}): NormalizedCandidate {
  return {
    id: candidateId(params.platform, params.externalId),
    externalId: params.externalId,
    platform: params.platform,
    url: params.url,
    thumbnailUrl: params.thumbnailUrl,
    title: params.title,
    caption: params.caption,
    creator: params.creator,
    metadata: params.metadata,
    sourceQuery: params.sourceQuery,
    retrievedAt: new Date().toISOString(),
  };
}
