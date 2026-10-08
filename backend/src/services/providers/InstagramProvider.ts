import { env } from "../../config/env";
import { ProviderBatch, VideoCandidate } from "../../types";
import { termsForRound } from "../brain/productAnalysis";
import { pick, runActor, toIso } from "./apifyClient";
import { mockCandidates } from "./mockData";
import { ProviderSearchOptions, VideoProvider } from "./VideoProvider";

/**
 * Instagram Reels via Apify's Instagram Hashtag Scraper.
 *
 * Why hashtags: Instagram has no public keyword search for reels, but creators
 * tag product videos consistently (#stanleyquencher), and the brain produces
 * hashtags ordered from exact product to broader brand/type tags. Each round
 * takes the next slice of hashtags and asks for deeper results.
 */
export class InstagramProvider implements VideoProvider {
  readonly platform = "instagram" as const;

  termsFor(plan: { instagramHashtags: string[] }, round: number): string[] {
    return termsForRound(plan.instagramHashtags, round, 4);
  }

  async search(terms: string[], opts: ProviderSearchOptions): Promise<ProviderBatch> {
    if (!terms.length) return { candidates: [], skipped: 0 };
    if (env.providerMode === "mock") return mockCandidates("instagram", terms, opts);

    const perTag = Math.min(80, Math.ceil(opts.limit / terms.length) * (opts.round + 1));
    const items = await runActor(env.apify.instagramActor, {
      hashtags: terms,
      resultsType: "reels",
      resultsLimit: perTag,
    });

    const candidates: VideoCandidate[] = [];
    let skipped = 0;
    for (const it of items) {
      const isVideo = it.type === "Video" || it.productType === "clips" || Boolean(it.videoUrl);
      const shortCode = pick(it, "shortCode", "code");
      const id = String(pick(it, "id", "pk", "shortCode") || "");
      if (!isVideo || !id || it.error) {
        skipped++;
        continue;
      }
      candidates.push({
        key: `instagram:${id}`,
        platform: "instagram",
        externalId: id,
        url: shortCode ? `https://www.instagram.com/reel/${shortCode}/` : String(it.url || ""),
        thumbnailUrl: pick(it, "displayUrl", "thumbnailUrl", "images.0"),
        videoUrl: pick(it, "videoUrl"),
        caption: pick(it, "caption"),
        creator: pick(it, "ownerUsername", "ownerFullName"),
        postedAt: toIso(pick(it, "timestamp", "takenAtTimestamp")),
        engagement: Number(pick(it, "videoPlayCount", "videoViewCount", "likesCount") || 0),
        sourceQuery: `#${String(pick(it, "inputUrl") || "").match(/\/tags\/([^/?#]+)/)?.[1] || pick(it, "hashtag", "query") || terms[0]}`,
        raw: { likes: it.likesCount, comments: it.commentsCount, hashtags: it.hashtags },
      });
    }
    return { candidates, skipped };
  }
}
