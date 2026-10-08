import { createHash } from "crypto";
import { NormalizedCandidate } from "../../types";
import { toNormalized } from "../search/normalize";

/** Short, well-distributed id fragment. (Hex-encoding the raw string, as opposed to
 * hashing it, would just re-expose the string's own prefix and collide constantly
 * for inputs that share a prefix - e.g. the same query reused across iterations.) */
function shortHash(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

// Deterministic pseudo-random generator so the same query always returns the
// same mock set in one process (stable for demo/testing) but still varies by query.
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
const REEL_PHRASES = [
  "full review and try-on!",
  "is this worth the hype?",
  "first impressions after a week",
  "unboxing + close-up details",
  "styled 3 ways",
  "honest thoughts before you buy",
  "comparing it to the last version",
  "what nobody tells you about it",
];
const AD_PHRASES = [
  "Limited time offer, free shipping.",
  "Now back in stock.",
  "Rated 4.8 stars by customers.",
  "Bundle and save this week.",
  "New colorway just dropped.",
  "Selling fast - shop before it's gone.",
];

/**
 * Generates mock Instagram Reel candidates. A majority are built from the
 * query terms (so they textually/visually resemble the product); a minority
 * are intentionally off-topic so downstream text filtering and visual
 * verification have real mismatches to reject, matching the assignment's
 * "similar-but-wrong product" test case.
 */
export function mockReels(queries: string[], count: number): NormalizedCandidate[] {
  const out: NormalizedCandidate[] = [];
  const offTopicPool = ["random vlog clip", "unrelated travel reel", "daily routine video", "funny pet clip"];

  queries.forEach((q, qi) => {
    const rand = seededRandom(`ig:${q}`);
    const perQuery = Math.ceil(count / queries.length) + 1;
    for (let i = 0; i < perQuery; i++) {
      const idx = `${qi}_${i}`;
      const isOffTopic = rand() < 0.15;
      const creator = CREATORS[Math.floor(rand() * CREATORS.length)];
      const phrase = REEL_PHRASES[Math.floor(rand() * REEL_PHRASES.length)];
      const caption = isOffTopic
        ? offTopicPool[Math.floor(rand() * offTopicPool.length)]
        : `${q} - ${phrase} #${q.replace(/\s+/g, "")}`;

      out.push(
        toNormalized({
          platform: "instagram",
          externalId: `ig_${shortHash(q + idx)}`,
          url: `https://www.instagram.com/reel/mock_${shortHash(q + idx).slice(0, 10)}/`,
          thumbnailUrl: `https://picsum.photos/seed/${encodeURIComponent("ig" + q + idx)}/300/400`,
          caption,
          creator,
          title: caption.slice(0, 60),
          metadata: { mock: true, likes: Math.floor(rand() * 50000), isOffTopic },
          sourceQuery: q,
        })
      );
    }
  });

  return out.slice(0, count);
}

export function mockAds(queries: string[], count: number): NormalizedCandidate[] {
  const out: NormalizedCandidate[] = [];
  const offTopicPool = ["unrelated clearance sale", "generic brand awareness ad", "holiday promo (other category)"];

  queries.forEach((q, qi) => {
    const rand = seededRandom(`meta:${q}`);
    const perQuery = Math.ceil(count / queries.length) + 1;
    for (let i = 0; i < perQuery; i++) {
      const idx = `${qi}_${i}`;
      const isOffTopic = rand() < 0.15;
      const page = PAGES[Math.floor(rand() * PAGES.length)];
      const phrase = AD_PHRASES[Math.floor(rand() * AD_PHRASES.length)];
      const body = isOffTopic
        ? offTopicPool[Math.floor(rand() * offTopicPool.length)]
        : `Shop ${q} today. ${phrase}`;

      out.push(
        toNormalized({
          platform: "meta_ads",
          externalId: `meta_${shortHash(q + idx)}`,
          url: `https://www.facebook.com/ads/library/?id=mock_${shortHash(q + idx).slice(0, 10)}`,
          thumbnailUrl: `https://picsum.photos/seed/${encodeURIComponent("meta" + q + idx)}/300/300`,
          caption: body,
          creator: page,
          title: `${page} - Sponsored`,
          metadata: { mock: true, spendRangeUsd: "100-499", isOffTopic },
          sourceQuery: q,
        })
      );
    }
  });

  return out.slice(0, count);
}
