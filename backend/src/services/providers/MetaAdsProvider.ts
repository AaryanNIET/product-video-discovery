import axios from "axios";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { withRetry } from "../../utils/retry";
import { toNormalized } from "../search/normalize";
import { emptyResult, partitionResult, VideoProvider } from "./VideoProvider";
import { ProviderSearchResult } from "../../types";
import { mockAds } from "./mockData";

/**
 * Meta Ad Library provider.
 *
 * LIVE MODE: The Meta Ad Library API (graph.facebook.com/.../ads_archive) IS
 * public and keyword-searchable without special partnership, but it requires
 * an access token tied to an identity-verified developer, enforces per-app
 * rate limits, and only returns ads currently or recently active (so coverage
 * for a given product can legitimately be thin). This adapter calls that
 * endpoint directly when META_AD_LIBRARY_ACCESS_TOKEN is set.
 *
 * MOCK MODE (default): deterministic mock ad candidates for local development.
 */
export class MetaAdsProvider implements VideoProvider {
  readonly platform = "meta_ads" as const;

  async search(queries: string[], minimumResults: number): Promise<ProviderSearchResult> {
    if (env.providerMode === "live") {
      return this.searchLive(queries, minimumResults);
    }
    return this.searchMock(queries, minimumResults);
  }

  private async searchMock(queries: string[], minimumResults: number): Promise<ProviderSearchResult> {
    const candidates = mockAds(queries, Math.max(minimumResults, 20) * 4);
    return partitionResult("meta_ads", candidates, minimumResults);
  }

  private async searchLive(queries: string[], minimumResults: number): Promise<ProviderSearchResult> {
    if (!env.metaAds.accessToken) {
      return emptyResult(
        "meta_ads",
        minimumResults,
        "META_AD_LIBRARY_ACCESS_TOKEN not configured. See README 'Known limitations'."
      );
    }

    try {
      const all = [];
      for (const q of queries) {
        const batch = await withRetry(
          async () => {
            const res = await axios.get(
              `https://graph.facebook.com/${env.metaAds.apiVersion}/ads_archive`,
              {
                params: {
                  search_terms: q,
                  ad_type: "ALL",
                  ad_reached_countries: "['US']",
                  media_type: "VIDEO",
                  access_token: env.metaAds.accessToken,
                },
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
              platform: "meta_ads",
              externalId: String(item.id),
              url: item.ad_snapshot_url || `https://www.facebook.com/ads/library/?id=${item.id}`,
              thumbnailUrl: item.image_url,
              title: item.page_name,
              caption: item.ad_creative_bodies?.[0],
              creator: item.page_name,
              metadata: item,
              sourceQuery: q,
            })
          )
        );
      }
      return partitionResult("meta_ads", all, minimumResults);
    } catch (err) {
      logger.error("Meta Ad Library live search failed", { error: (err as Error).message });
      return emptyResult("meta_ads", minimumResults, (err as Error).message);
    }
  }
}
