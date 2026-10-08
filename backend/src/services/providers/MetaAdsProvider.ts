import { env } from "../../config/env";
import { ProviderBatch, VideoCandidate } from "../../types";
import { termsForRound } from "../brain/productAnalysis";
import { pick, runActor, toIso } from "./apifyClient";
import { mockCandidates } from "./mockData";
import { perTermLimit, ProviderSearchOptions, VideoProvider } from "./VideoProvider";

/** Public Ad Library search URL for video ads matching a keyword, across all countries and ad types. */
export function adLibrarySearchUrl(term: string, country = env.apify.adLibraryCountry): string {
  const params = new URLSearchParams({
    active_status: "all",
    ad_type: "all",
    country,
    media_type: "video",
    q: term,
    search_type: "keyword_unordered",
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

/**
 * Meta Ad Library video ads via Apify's Facebook Ads Scraper.
 *
 * Why not the official Ad Library API: it only returns all ad types for ads
 * delivered in the EU/UK (elsewhere it is limited to political/issue ads) and
 * needs an identity-verified developer account. The public Ad Library website
 * shows every commercial ad, and the scraper reads exactly that page.
 */
export class MetaAdsProvider implements VideoProvider {
  readonly platform = "meta_ads" as const;

  termsFor(plan: { metaKeywords: string[] }, round: number): string[] {
    return termsForRound(plan.metaKeywords, round, 3);
  }

  async search(terms: string[], opts: ProviderSearchOptions): Promise<ProviderBatch> {
    if (!terms.length) return { candidates: [], skipped: 0 };
    if (env.providerMode === "mock") return mockCandidates("meta_ads", terms, opts);

    const items = await runActor(env.apify.metaAdsActor, {
      startUrls: terms.map((t) => ({ url: adLibrarySearchUrl(t) })),
      resultsLimit: perTermLimit(opts, terms), // applies per start URL, not per run
      isDetailsPerAd: false,
    });

    const candidates: VideoCandidate[] = [];
    let skipped = 0;
    for (const it of items) {
      const id = String(pick(it, "adArchiveID", "adArchiveId", "ad_archive_id", "id") || "");
      const snap = it.snapshot || {};
      const videos: any[] = [
        ...(snap.videos || []),
        ...((snap.cards || []) as any[]).filter((c) => pick(c, "video_hd_url", "videoHdUrl", "video_sd_url", "videoSdUrl")),
      ];
      const video = videos[0];
      const thumb = video && pick(video, "video_preview_image_url", "videoPreviewImageUrl", "resized_image_url");
      const videoUrl = video && pick(video, "video_hd_url", "videoHdUrl", "video_sd_url", "videoSdUrl");
      if (!id || (!thumb && !videoUrl)) {
        skipped++;
        continue;
      }
      const body = pick(snap, "body.text", "body.markup.__html", "cards.0.body") || pick(it, "adText", "body");
      const title = pick(snap, "title", "cards.0.title");
      const caption = [title, body].filter((s) => s && !/\{\{.*\}\}/.test(String(s))).join(" — ");

      candidates.push({
        key: `meta_ads:${id}`,
        platform: "meta_ads",
        externalId: id,
        url: `https://www.facebook.com/ads/library/?id=${id}`,
        thumbnailUrl: thumb,
        videoUrl,
        caption: caption || undefined,
        creator: pick(snap, "page_name", "pageName") || pick(it, "pageName", "page_name"),
        postedAt: toIso(pick(it, "startDate", "start_date", "startDateFormatted")),
        engagement: Number(pick(it, "collationCount", "collation_count") || 0),
        groupId: pick(it, "collationID", "collationId", "collation_id") ? String(pick(it, "collationID", "collationId", "collation_id")) : undefined,
        sourceQuery: String(pick(it, "inputUrl", "url") || "").match(/[?&]q=([^&]+)/)?.[1]
          ? decodeURIComponent(String(pick(it, "inputUrl", "url")).match(/[?&]q=([^&]+)/)![1].replace(/\+/g, " "))
          : terms[0],
        raw: { isActive: pick(it, "isActive", "is_active"), linkUrl: pick(snap, "link_url", "linkUrl"), platforms: pick(it, "publisherPlatform", "publisher_platform") },
      });
    }
    return { candidates, skipped };
  }
}
