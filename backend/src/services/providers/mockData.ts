import { createHash } from "crypto";
import { Platform, ProviderBatch, VideoCandidate } from "../../types";
import { ProviderSearchOptions } from "./VideoProvider";

/**
 * Offline stand-in for the scrapers (PROVIDER_MODE=mock). Output is
 * deterministic per term + round, so a repeated search returns the same IDs
 * and exercises the "previously seen" filter and the refill rounds. About 15%
 * of items are deliberately off-topic so the scorer has mismatches to reject.
 */
const shortHash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

function seededRandom(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return h / 0xffffffff;
  };
}

const CREATORS = ["unbox.daily", "reviewloop", "street.style.now", "gadget.grid", "trendwatch_", "the.unboxer"];
const PAGES = ["ShopNova", "UrbanThreads", "PeakGear", "BrightCart", "DailyEssentials", "NextAisle"];
const PHRASES = ["full review and try-on", "is this worth the hype?", "unboxing + close-up details", "styled 3 ways", "honest thoughts before you buy", "limited time offer, free shipping", "now back in stock"];
const OFF_TOPIC = ["random vlog clip", "unrelated travel reel", "funny pet clip", "generic clearance sale"];

export function mockCandidates(platform: Platform, terms: string[], opts: ProviderSearchOptions): ProviderBatch {
  const perTerm = Math.ceil(opts.limit / terms.length);
  const candidates: VideoCandidate[] = [];

  terms.forEach((term, ti) => {
    const rand = seededRandom(`${platform}:${term}:${opts.round}`);
    for (let i = 0; i < perTerm; i++) {
      const id = `${platform.slice(0, 2)}_${shortHash(`${term}:${opts.round}:${i}`)}`;
      const offTopic = rand() < 0.15;
      const label = term.replace(/^#/, "");
      const caption = offTopic ? OFF_TOPIC[Math.floor(rand() * OFF_TOPIC.length)] : `${label} - ${PHRASES[Math.floor(rand() * PHRASES.length)]} #${label.replace(/\s+/g, "")}`;
      candidates.push({
        key: `${platform}:${id}`,
        platform,
        externalId: id,
        url: platform === "meta_ads" ? `https://www.facebook.com/ads/library/?id=${id}` : platform === "tiktok" ? `https://www.tiktok.com/@mock/video/${id}` : `https://www.instagram.com/reel/${id}/`,
        thumbnailUrl: `https://picsum.photos/seed/${id}/360/480`,
        caption,
        creator: platform === "meta_ads" ? PAGES[Math.floor(rand() * PAGES.length)] : CREATORS[Math.floor(rand() * CREATORS.length)],
        postedAt: new Date(Date.now() - Math.floor(rand() * 90) * 86400_000).toISOString(),
        engagement: Math.floor(rand() * 50000),
        sourceQuery: term,
        raw: { mock: true, isOffTopic: offTopic, termIndex: ti },
      });
    }
  });
  return { candidates, skipped: 0 };
}
