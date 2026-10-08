import { env } from "../../config/env";
import { Platform, ProductIdentity, SourceSummary, VideoCandidate } from "../../types";
import { logger } from "../../utils/logger";
import { mapLimit } from "../../utils/concurrency";
import { resolveProduct } from "../product/productResolver";
import { scoreCandidates, textRelevance } from "../brain/matchScorer";
import { dedupeCandidates } from "../dedupe/dedupe";
import { seenStore } from "../dedupe/seenStore";
import { cacheThumbnail, sha1 } from "../media/imageStore";
import { InstagramProvider } from "../providers/InstagramProvider";
import { MetaAdsProvider } from "../providers/MetaAdsProvider";
import { TikTokProvider } from "../providers/TikTokProvider";
import { VideoProvider } from "../providers/VideoProvider";
import { emit, finishJob, Job, persist, setProgress } from "./jobs";

const providers: Record<Platform, VideoProvider> = {
  instagram: new InstagramProvider(),
  meta_ads: new MetaAdsProvider(),
  tiktok: new TikTokProvider(),
};

const REQUIRED: Platform[] = ["instagram", "meta_ads"];
/** Raw items requested per round; generous because dedupe + scoring discard many. */
const RAW_PER_ROUND = 60;
/** Previously-seen videos kept per source for the "Show previously seen" toggle. */
const MAX_PREVIOUSLY_SEEN = 40;

function emptySummary(platform: Platform, enabled: boolean): SourceSummary {
  return {
    platform,
    enabled,
    status: enabled ? "pending" : "disabled",
    accepted: [],
    belowThreshold: [],
    previouslySeen: [],
    stats: { fetched: 0, duplicates: 0, previouslySeen: 0, scored: 0, rounds: 0 },
    queriesUsed: [],
  };
}

/** Accepted videos: best match first; engagement and recency only break ties. */
export function rankAccepted(list: VideoCandidate[]): VideoCandidate[] {
  return [...list].sort(
    (a, b) =>
      (b.match?.score ?? 0) - (a.match?.score ?? 0) ||
      (b.engagement ?? 0) - (a.engagement ?? 0) ||
      (b.postedAt || "").localeCompare(a.postedAt || "")
  );
}

/** Runs one complete search: resolve product, analyse image, collect every source in parallel, record results. */
export async function runSearch(job: Job, upload: Buffer | null): Promise<void> {
  const tiktokOn = job.includeTikTok && env.tiktok.enabled;
  const platforms: Platform[] = tiktokOn ? [...REQUIRED, "tiktok"] : REQUIRED;
  job.sources = {
    instagram: emptySummary("instagram", true),
    meta_ads: emptySummary("meta_ads", true),
    tiktok: emptySummary("tiktok", tiktokOn),
  };

  // 1-2. Product resolver + image brain (cached per link / image).
  let identity: ProductIdentity;
  let reference: Buffer | null;
  try {
    const resolved = await resolveProduct(job.input, upload, (step, status, detail) => setProgress(job, step, status, detail));
    identity = resolved.identity;
    reference = resolved.reference;
    job.product = identity;
    emit(job);
  } catch (err) {
    const msg = (err as Error).message;
    const failedStep = job.progress.find((p) => p.status === "active")?.step || "fetch_page";
    setProgress(job, failedStep, "error", msg);
    return finishJob(job, "failed", msg);
  }

  // 3. Collect every source in parallel; one failing source never stops the others.
  for (const p of ["instagram", "meta_ads", "tiktok"] as Platform[]) {
    if (!platforms.includes(p)) setProgress(job, `search_${p}`, "skipped", "Turned off");
  }
  setProgress(job, "scoring", "active", "Waiting for videos");
  await Promise.allSettled(platforms.map((p) => collectSource(job, p, identity, reference)));

  // 4. Record everything shown so later searches surface new videos.
  const shown = platforms.flatMap((p) => [...job.sources[p]!.accepted, ...job.sources[p]!.belowThreshold]);
  await seenStore.record(shown, job.jobId);

  const totalScored = platforms.reduce((n, p) => n + job.sources[p]!.stats.scored, 0);
  setProgress(job, "scoring", "done", `${totalScored} videos scored`);

  const required = REQUIRED.map((p) => job.sources[p]!);
  const status = required.every((s) => s.status === "failed") ? "failed" : required.every((s) => s.status === "ok") ? "completed" : "partial";
  finishJob(job, status, status === "failed" ? required.map((s) => s.error).filter(Boolean).join(" | ") : undefined);
}

async function collectSource(job: Job, platform: Platform, identity: ProductIdentity, reference: Buffer | null) {
  const provider = providers[platform];
  const summary = job.sources[platform]!;
  const step = `search_${platform}`;
  const min = env.matching.perSourceMinimum;
  const processed: VideoCandidate[] = []; // everything already handled in this search (for in-search dedupe)
  const plan = { ...identity.searchPlan, instagramHashtags: [...identity.searchPlan.instagramHashtags] };
  summary.status = "running";

  for (let round = 0; round < env.matching.maxRounds; round++) {
    // Refill strategy: next slice of wider terms; when the plan runs out, repeat the
    // terms already used with deeper pagination (providers fetch more per round).
    let terms = provider.termsFor(plan, round);
    if (!terms.length && round === 0) terms = [identity.title];
    if (!terms.length) terms = [...new Set(summary.queriesUsed.map((q) => q.replace(/^#/, "")))].slice(0, 4);
    if (!terms.length) break;
    summary.queriesUsed.push(...terms.filter((t) => !summary.queriesUsed.includes(t)));
    summary.stats.rounds = round + 1;
    setProgress(job, step, "active", `Round ${round + 1}: ${terms.slice(0, 3).join(", ")}${terms.length > 3 ? "…" : ""}`);

    // Scrape.
    let fetched: VideoCandidate[];
    try {
      const batch = await provider.search(terms, { round, limit: RAW_PER_ROUND });
      fetched = batch.candidates;
      summary.stats.fetched += fetched.length;
    } catch (err) {
      const msg = (err as Error).message;
      logger.warn("Source round failed", { platform, round, error: msg });
      summary.error = msg;
      if (round === 0) {
        summary.status = "failed";
        setProgress(job, step, "error", msg);
        emit(job);
        return;
      }
      break; // keep what earlier rounds found
    }

    // Dedupe inside this search (ids, media files, ad creatives, reposts).
    const firstPass = dedupeCandidates(fetched, processed);
    summary.stats.duplicates += firstPass.duplicates.length;

    // Drop videos shown in earlier searches (kept aside for the "Show previously seen" toggle).
    const fresh: VideoCandidate[] = [];
    for (const c of firstPass.unique) {
      const seen = seenStore.findByIdentity(c);
      if (seen) markSeen(summary, c, seen);
      else fresh.push(c);
    }
    processed.push(...firstPass.unique);

    // Most promising first, so the vision budget is spent where matches are likely.
    fresh.forEach((c) => (c.textScore = textRelevance(c, identity)));
    fresh.sort((a, b) => (b.textScore ?? 0) - (a.textScore ?? 0));

    const budget = Math.max(0, env.matching.maxVisionPerSource - summary.stats.scored);
    const toCheck = fresh.slice(0, budget);

    // Cache thumbnails (+ perceptual hash) for the candidates we will score.
    const images = new Map<string, Buffer>();
    await mapLimit(toCheck, 8, async (c) => {
      if (!c.thumbnailUrl) return;
      try {
        const t = await cacheThumbnail(c.key, c.thumbnailUrl);
        c.thumbId = t.thumbId;
        c.phash = t.phash;
        images.set(c.key, t.visionJpeg);
      } catch (err) {
        logger.debug("Thumbnail download failed", { key: c.key, error: (err as Error).message });
      }
    });

    // Second dedupe pass with perceptual hashes: re-uploads of the same video under new ids.
    const alreadyKept = [...summary.accepted, ...summary.belowThreshold];
    const visual = dedupeCandidates(toCheck, alreadyKept);
    summary.stats.duplicates += visual.duplicates.length;
    const unique: VideoCandidate[] = [];
    for (const c of visual.unique) {
      const seen = seenStore.findByPhash(c);
      if (seen) markSeen(summary, c, seen);
      else unique.push(c);
    }

    // Vision scoring.
    setProgress(job, "scoring", "active", `Scoring ${unique.length} ${label(platform)} videos`);
    const scores = await scoreCandidates(identity, reference, unique.map((c) => ({ candidate: c, image: images.get(c.key) || null })));
    summary.stats.scored += unique.length;
    for (const c of unique) {
      c.match = scores.get(c.key);
      if ((c.match?.score ?? 0) >= env.matching.threshold) summary.accepted.push(c);
      else summary.belowThreshold.push(c);
    }
    summary.accepted = rankAccepted(summary.accepted);
    summary.belowThreshold = rankAccepted(summary.belowThreshold).slice(0, 60);

    setProgress(job, step, "active", `${summary.accepted.length}/${min} verified after round ${round + 1}`);
    persist(job);

    if (summary.accepted.length >= min) break;
    if (summary.stats.scored >= env.matching.maxVisionPerSource) break;
    if (platform === "instagram") addRelatedHashtags(plan, summary.accepted, round);
  }

  summary.status = summary.accepted.length >= min ? "ok" : summary.accepted.length || !summary.error ? "partial" : "failed";
  if (summary.accepted.length < min) summary.shortfall = explainShortfall(summary);
  setProgress(job, step, summary.status === "failed" ? "error" : "done", `${summary.accepted.length}/${min} verified matches`);
}

function markSeen(summary: SourceSummary, c: VideoCandidate, seen: { jobId: string; at: string }) {
  summary.stats.previouslySeen++;
  if (summary.previouslySeen.length >= MAX_PREVIOUSLY_SEEN) return;
  c.previouslySeen = { jobId: seen.jobId, at: seen.at };
  c.thumbId = sha1(c.key); // thumbnail was cached when it was first shown
  summary.previouslySeen.push(c);
}

/**
 * "Related hashtags": tags that co-occur on videos the brain already verified
 * are good bets for finding more of the same product. They are queued right
 * after the current round's terms.
 */
export function addRelatedHashtags(plan: { instagramHashtags: string[] }, verified: VideoCandidate[], round: number) {
  const counts = new Map<string, number>();
  for (const c of verified) {
    const tags: string[] = Array.isArray((c.raw as any)?.hashtags) ? (c.raw as any).hashtags : (c.caption || "").match(/#[\p{L}\p{N}_]+/gu) || [];
    for (const t of new Set(tags.map((x) => x.replace(/^#/, "").toLowerCase()))) counts.set(t, (counts.get(t) || 0) + 1);
  }
  const related = [...counts.entries()]
    .filter(([t, n]) => n >= 2 && t.length > 3 && !plan.instagramHashtags.includes(t) && !/^(fyp|foryou|viral|reels?|explore|trending|ad|sponsored)/.test(t))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([t]) => t);
  if (related.length) plan.instagramHashtags.splice((round + 1) * 4, 0, ...related);
}

const label = (p: Platform) => (p === "meta_ads" ? "Meta" : p === "instagram" ? "Instagram" : "TikTok");

/** Shown in the UI when a source ends below the minimum, so a shortfall is never silent. */
export function explainShortfall(s: SourceSummary): string {
  const { fetched, duplicates, previouslySeen, scored, rounds } = s.stats;
  const parts = [
    `Found ${s.accepted.length} of ${env.matching.perSourceMinimum} verified matches after ${rounds} search round${rounds === 1 ? "" : "s"}`,
    `${fetched} videos fetched, ${duplicates} duplicates removed, ${previouslySeen} already shown in earlier searches, ${scored} checked by the image brain`,
    `${s.belowThreshold.length} scored below the ${env.matching.threshold} match threshold (see "Show below threshold")`,
  ];
  if (s.error) parts.push(`Last error: ${s.error}`);
  parts.push("Try a more specific product link or upload a clearer product photo.");
  return parts.join(". ") + ".";
}
