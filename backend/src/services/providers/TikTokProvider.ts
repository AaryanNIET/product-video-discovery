import { env } from "../../config/env";
import { ProviderBatch, VideoCandidate } from "../../types";
import { termsForRound } from "../brain/productAnalysis";
import { pick, runActor, toIso } from "./apifyClient";
import { mockCandidates } from "./mockData";
import { ProviderSearchOptions, VideoProvider } from "./VideoProvider";

/**
 * Optional third source: TikTok search via Apify's TikTok Scraper. It runs only
 * when the user switches it on, in parallel with the required sources, and its
 * failures are reported but never block Instagram or Meta.
 */
export class TikTokProvider implements VideoProvider {
  readonly platform = "tiktok" as const;

  termsFor(plan: { tiktokKeywords: string[] }, round: number): string[] {
    return termsForRound(plan.tiktokKeywords, round, 3);
  }

  async search(terms: string[], opts: ProviderSearchOptions): Promise<ProviderBatch> {
    if (!terms.length) return { candidates: [], skipped: 0 };
    if (env.providerMode === "mock") return mockCandidates("tiktok", terms, opts);

    const items = await runActor(env.apify.tiktokActor, {
      searchQueries: terms,
      resultsPerPage: Math.min(60, Math.ceil(opts.limit / terms.length) * (opts.round + 1)),
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
    });

    const candidates: VideoCandidate[] = [];
    let skipped = 0;
    for (const it of items) {
      const id = String(pick(it, "id") || "");
      const url = pick(it, "webVideoUrl");
      if (!id || !url || it.isSlideshow) {
        skipped++;
        continue;
      }
      candidates.push({
        key: `tiktok:${id}`,
        platform: "tiktok",
        externalId: id,
        url,
        thumbnailUrl: pick(it, "videoMeta.coverUrl", "videoMeta.originalCoverUrl", "covers.0"),
        caption: pick(it, "text"),
        creator: pick(it, "authorMeta.name", "authorMeta.nickName"),
        postedAt: toIso(pick(it, "createTimeISO", "createTime")),
        engagement: Number(pick(it, "playCount", "diggCount") || 0),
        sourceQuery: String(pick(it, "searchQuery", "input") || terms[0]),
        raw: { likes: it.diggCount, plays: it.playCount },
      });
    }
    return { candidates, skipped };
  }
}
