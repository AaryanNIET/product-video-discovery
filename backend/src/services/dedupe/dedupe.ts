import { createHash } from "crypto";
import { VideoCandidate } from "../../types";
import { hammingDistance } from "../media/imageStore";

/** Max differing bits (of 64) for two thumbnails to count as the same video. */
export const PHASH_NEAR_DUPLICATE_BITS = 5;

/**
 * Media URLs carry rotating signatures in the query string; the path (which
 * holds the CDN file name) identifies the actual media file.
 */
export function mediaKeyOf(c: Pick<VideoCandidate, "videoUrl" | "thumbnailUrl">): string | undefined {
  const raw = c.videoUrl;
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    const file = u.pathname.split("/").filter(Boolean).pop() || "";
    if (file.length < 12) return undefined; // too generic to identify a file
    return createHash("sha1").update(file).digest("hex").slice(0, 20);
  } catch {
    return undefined;
  }
}

/** Caption with hashtags, mentions, links, emoji and punctuation removed; null when too short to be distinctive. */
export function captionFingerprint(caption?: string): string | null {
  if (!caption) return null;
  const text = caption
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#@]\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length >= 25 ? text.slice(0, 200) : null;
}

/** Near-blank or single-colour thumbnails hash to almost all 0s or 1s and would collide with each other. */
export function isInformativePhash(phash?: string): boolean {
  if (!phash) return false;
  const ones = BigInt("0x" + phash).toString(2).split("").filter((b) => b === "1").length;
  return ones >= 8 && ones <= 56;
}

export type DuplicateReason = "same id" | "same media file" | "same ad creative" | "same caption and creator" | "visually identical thumbnail";

export interface DedupeResult {
  unique: VideoCandidate[];
  duplicates: Array<{ candidate: VideoCandidate; of: string; reason: DuplicateReason }>;
}

/**
 * Removes duplicates and near-duplicates inside one result set. Signals, from
 * cheapest to most robust:
 *  1. platform + external id (exact repeats across queries / rounds)
 *  2. same media file name (one video referenced by several posts or ad IDs)
 *  3. Meta collation id (one creative running as several ads)
 *  4. same normalised caption from the same creator (reposts)
 *  5. perceptual hash of the thumbnail within 5 bits (re-uploads, re-encodes, other accounts)
 * The first occurrence wins, so callers should pass candidates best-first.
 */
export function dedupeCandidates(candidates: VideoCandidate[], already: VideoCandidate[] = []): DedupeResult {
  const byKey = new Map<string, string>();
  const byMedia = new Map<string, string>();
  const byGroup = new Map<string, string>();
  const byCaption = new Map<string, string>();
  const hashes: Array<{ phash: string; key: string }> = [];

  const remember = (c: VideoCandidate) => {
    byKey.set(c.key, c.key);
    const m = mediaKeyOf(c);
    if (m) byMedia.set(m, c.key);
    if (c.groupId) byGroup.set(`${c.platform}:${c.groupId}`, c.key);
    const fp = captionFingerprint(c.caption);
    if (fp) byCaption.set(`${c.creator || ""}|${fp}`, c.key);
    if (isInformativePhash(c.phash)) hashes.push({ phash: c.phash!, key: c.key });
  };
  already.forEach(remember);

  const unique: VideoCandidate[] = [];
  const duplicates: DedupeResult["duplicates"] = [];

  for (const c of candidates) {
    let of: string | undefined;
    let reason: DuplicateReason | undefined;
    const m = mediaKeyOf(c);
    const fp = captionFingerprint(c.caption);

    if (byKey.has(c.key)) [of, reason] = [byKey.get(c.key), "same id"];
    else if (m && byMedia.has(m)) [of, reason] = [byMedia.get(m), "same media file"];
    else if (c.groupId && byGroup.has(`${c.platform}:${c.groupId}`)) [of, reason] = [byGroup.get(`${c.platform}:${c.groupId}`), "same ad creative"];
    else if (fp && byCaption.has(`${c.creator || ""}|${fp}`)) [of, reason] = [byCaption.get(`${c.creator || ""}|${fp}`), "same caption and creator"];
    else if (isInformativePhash(c.phash)) {
      const hit = hashes.find((h) => hammingDistance(h.phash, c.phash!) <= PHASH_NEAR_DUPLICATE_BITS);
      if (hit) [of, reason] = [hit.key, "visually identical thumbnail"];
    }

    if (of && reason) duplicates.push({ candidate: c, of, reason });
    else {
      unique.push(c);
      remember(c);
    }
  }
  return { unique, duplicates };
}
