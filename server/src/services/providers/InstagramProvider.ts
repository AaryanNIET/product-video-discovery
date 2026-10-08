import axios from "axios";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { withRetry } from "../../utils/retry";
import { toNormalized } from "../search/normalize";
import { emptyResult, partitionResult, VideoProvider } from "./VideoProvider";
import { ProviderSearchResult } from "../../types";
import { mockReels } from "./mockData";

/**
 * Instagram Reels provider.
 *
 * LIVE MODE: Instagram/Meta does not expose a general public "search reels by
 * keyword" endpoint to third-party apps. In practice, authorized access is
 * limited to: (a) the Graph API for content an app/user owns or manages, or
 * (b) an approved Meta Content Library / research partnership. This adapter
 * is written against the Graph API shape so real credentials can be dropped
 * in (INSTAGRAM_ACCESS_TOKEN) once a compliant data-access path is available;
 * until then it fails gracefully with a clear, documented limitation rather
 * than scraping.
 *
 * MOCK MODE (default): returns deterministic, clearly-labeled mock candidates
 * so the full pipeline (dedupe -> text filter -> visual verification -> ranking)
 * is exercisable end-to-end without credentials.
 */
export class InstagramProvider implements VideoProvider {
  readonly platform = "instagram" as const;

  async search(queries: string[], minimumResults: number): Promise<ProviderSearchResult> {
    if (env.providerMode === "live") {
      return this.searchLive(queries, minimumResults);
    }
    return this.searchMock(queries, minimumResults);
  }

  private async searchMock(queries: string[], minimumResults: number): Promise<ProviderSearchResult> {
    // Over-fetch relative to the minimum: dedupe, text-filtering and visual
    // verification downstream will all shrink the pool, so a 1x pool would
    // chronically undershoot the 20-result target (mirrors "widen the query /
    // paginate deeper" from the spec, done up-front here since mock data has
    // no real pagination to drive).
    const candidates = mockReels(queries, Math.max(minimumResults, 20) * 4);
    return partitionResult("instagram", candidates, minimumResults);
  }

  private async searchLive(queries: string[], minimumResults: number): Promise<ProviderSearchResult> {
    if (!env.instagram.accessToken) {
      return emptyResult(
        "instagram",
        minimumResults,
        "INSTAGRAM_ACCESS_TOKEN not configured. Instagram has no public keyword-search API for " +
          "third-party apps; a Graph API token scoped to owned/managed content or an approved " +
          "Content Library partnership is required. See README 'Known limitations'."
      );
    }

    try {
      const all = [];
      for (const q of queries) {
        const batch = await withRetry(
          async () => {
            const res = await axios.get(
              `https://graph.facebook.com/${env.instagram.apiVersion}/ig_hashtag_search`,
              {
                params: { user_id: "me", q, access_token: env.instagram.accessToken },
                timeout: 8000,
              }
            );
            return res.data?.data ?? [];
          },
          { retries: 2, timeoutMs: 8000 }
        );
        all.push(
          ...batch.map((item: any) =>
            toNormalized({
              platform: "instagram",
              externalId: String(item.id),
              url: item.permalink || `https://instagram.com/reel/${item.id}`,
              thumbnailUrl: item.media_url || item.thumbnail_url,
              caption: item.caption,
              creator: item.username,
              metadata: item,
              sourceQuery: q,
            })
          )
        );
      }
      return partitionResult("instagram", all, minimumResults);
    } catch (err) {
      logger.error("Instagram live search failed", { error: (err as Error).message });
      return emptyResult("instagram", minimumResults, (err as Error).message);
    }
  }
}
