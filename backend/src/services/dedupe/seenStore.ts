import { Platform, VideoCandidate } from "../../types";
import { SeenVideoModel } from "../../models/SeenVideo";
import { isDbReady } from "../../db/connection";
import { hammingDistance } from "../media/imageStore";
import { isInformativePhash, mediaKeyOf, PHASH_NEAR_DUPLICATE_BITS } from "./dedupe";
import { logger } from "../../utils/logger";

export interface SeenEntry {
  key: string;
  platform: Platform;
  mediaKey?: string;
  phash?: string;
  jobId: string;
  at: string;
}

/**
 * Every video ever shown to the user, across all searches and products. Kept
 * in memory for fast checks and persisted in MongoDB so it survives restarts.
 */
class SeenStore {
  private byKey = new Map<string, SeenEntry>();
  private byMedia = new Map<string, SeenEntry>();
  private hashes: SeenEntry[] = [];

  async load(): Promise<void> {
    if (!isDbReady()) return;
    const docs = await SeenVideoModel.find().sort({ createdAt: -1 }).limit(50_000).lean();
    for (const d of docs) this.index({ key: d.key, platform: d.platform, mediaKey: d.mediaKey, phash: d.phash, jobId: d.jobId, at: d.createdAt.toISOString() });
    logger.info("Seen-video index loaded", { count: this.byKey.size });
  }

  private index(e: SeenEntry) {
    if (this.byKey.has(e.key)) return;
    this.byKey.set(e.key, e);
    if (e.mediaKey) this.byMedia.set(e.mediaKey, e);
    if (isInformativePhash(e.phash)) this.hashes.push(e);
  }

  /** Cheap check before downloading thumbnails: id or media file already shown. */
  findByIdentity(c: VideoCandidate): SeenEntry | undefined {
    const m = mediaKeyOf(c);
    return this.byKey.get(c.key) || (m ? this.byMedia.get(m) : undefined);
  }

  /** Visual check after the thumbnail hash is known: the same video re-uploaded under a new id. */
  findByPhash(c: VideoCandidate): SeenEntry | undefined {
    if (!isInformativePhash(c.phash)) return undefined;
    return this.hashes.find((h) => h.platform === c.platform && hammingDistance(h.phash!, c.phash!) <= PHASH_NEAR_DUPLICATE_BITS);
  }

  async record(candidates: VideoCandidate[], jobId: string): Promise<void> {
    const at = new Date().toISOString();
    const entries = candidates.map((c) => ({ key: c.key, platform: c.platform, mediaKey: mediaKeyOf(c), phash: c.phash, jobId, at }));
    entries.forEach((e) => this.index(e));
    if (!isDbReady() || !entries.length) return;
    try {
      await SeenVideoModel.bulkWrite(
        entries.map((e) => ({
          updateOne: { filter: { key: e.key }, update: { $setOnInsert: { key: e.key, platform: e.platform, mediaKey: e.mediaKey, phash: e.phash, jobId: e.jobId } }, upsert: true },
        })),
        { ordered: false }
      );
    } catch (err) {
      logger.warn("Could not persist seen videos", { error: (err as Error).message });
    }
  }

  get size() {
    return this.byKey.size;
  }
}

export const seenStore = new SeenStore();
