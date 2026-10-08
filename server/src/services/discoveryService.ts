import { nanoid } from "nanoid";
import { logger } from "../utils/logger";
import { resolveProduct } from "./product/productResolver";
import { InstagramProvider } from "./providers/InstagramProvider";
import { MetaAdsProvider } from "./providers/MetaAdsProvider";
import { dedupeCandidates, filterPreviouslySeen } from "./search/dedupe";
import { scoreTextMatch, TEXT_FILTER_THRESHOLD } from "./search/textFilter";
import { verifyCandidate } from "./verification/visualVerification";
import { rankCandidates } from "./ranking/ranker";
import { ProductModel } from "../models/Product";
import { DiscoveryJobModel } from "../models/DiscoveryJob";
import { VideoCandidateModel } from "../models/VideoCandidate";
import { NormalizedCandidate, ProgressStep } from "../types";

const PER_SOURCE_MINIMUM = 20;
const MAX_VISUAL_VERIFICATIONS_PER_SOURCE = 40; // cost control: never vision-score every candidate

const instagramProvider = new InstagramProvider();
const metaAdsProvider = new MetaAdsProvider();

// In-memory job registry mirrors the Mongo doc for fast polling; Mongo is the durable record.
const jobs = new Map<string, { status: string; progress: ProgressStep[] }>();

function pushProgress(jobId: string, step: string, status: ProgressStep["status"], detail?: string) {
  const entry: ProgressStep = { step, status, detail, at: new Date().toISOString() };
  const job = jobs.get(jobId);
  if (job) job.progress.push(entry);
  logger.info(`job:${jobId} ${step} -> ${status}`, detail ? { detail } : undefined);
}

export function getJobProgress(jobId: string) {
  return jobs.get(jobId);
}

export async function startDiscoveryJob(input: string): Promise<string> {
  const jobId = nanoid(12);
  jobs.set(jobId, { status: "pending", progress: [] });

  // Fire-and-forget: the HTTP layer returns {jobId} immediately and the client polls.
  runPipeline(jobId, input).catch((err) => {
    logger.error("Unhandled pipeline error", { jobId, error: (err as Error).message });
    const job = jobs.get(jobId);
    if (job) job.status = "failed";
  });

  return jobId;
}

async function runPipeline(jobId: string, input: string) {
  const job = jobs.get(jobId)!;
  job.status = "processing";

  // 1. Resolve product identity (cached by sourceInput where possible).
  pushProgress(jobId, "resolve_product", "active");
  let productDoc = await ProductModel.findOne({ sourceInput: input });
  let identity;
  let sourceType: "name" | "url";

  if (productDoc) {
    identity = productDoc.toObject();
    sourceType = productDoc.sourceType;
    pushProgress(jobId, "resolve_product", "done", "Loaded from cache");
  } else {
    try {
      const resolved = await resolveProduct(input);
      identity = resolved.identity;
      sourceType = resolved.sourceType;
      productDoc = await ProductModel.create({ ...identity, sourceType, sourceInput: input });
      pushProgress(jobId, "resolve_product", "done");
    } catch (err) {
      pushProgress(jobId, "resolve_product", "error", (err as Error).message);
      job.status = "failed";
      await DiscoveryJobModel.findOneAndUpdate(
        { jobId },
        { status: "failed", error: (err as Error).message },
        { upsert: true }
      );
      return;
    }
  }

  const jobDoc = await DiscoveryJobModel.create({
    jobId,
    product: productDoc._id,
    status: "processing",
  });

  // 2. Query generation already happened inside resolveProduct (identity.searchQueries).
  pushProgress(jobId, "generate_queries", "done", `${identity.searchQueries.length} queries`);

  // 3. Previously-seen ids for this product (uniqueness across searches).
  const priorIds = new Set(
    (await VideoCandidateModel.find({ product: productDoc._id }).distinct("externalId")).map(
      (id: string) => id
    )
  );

  // 4. Search providers concurrently; one failing provider must not break the other.
  pushProgress(jobId, "search_instagram", "active");
  pushProgress(jobId, "search_meta_ads", "active");

  const [igResult, metaResult] = await Promise.allSettled([
    instagramProvider.search(identity.searchQueries, PER_SOURCE_MINIMUM),
    metaAdsProvider.search(identity.searchQueries, PER_SOURCE_MINIMUM),
  ]);

  const ig = igResult.status === "fulfilled" ? igResult.value : { platform: "instagram" as const, candidates: [], status: "failed" as const, error: (igResult as PromiseRejectedResult).reason?.message, requestedMinimum: PER_SOURCE_MINIMUM, returned: 0 };
  const meta = metaResult.status === "fulfilled" ? metaResult.value : { platform: "meta_ads" as const, candidates: [], status: "failed" as const, error: (metaResult as PromiseRejectedResult).reason?.message, requestedMinimum: PER_SOURCE_MINIMUM, returned: 0 };

  pushProgress(jobId, "search_instagram", ig.status === "failed" ? "error" : "done", ig.error || `${ig.returned} candidates`);
  pushProgress(jobId, "search_meta_ads", meta.status === "failed" ? "error" : "done", meta.error || `${meta.returned} candidates`);

  // 5. Normalize is already done by providers. Dedupe + filter previously-seen.
  pushProgress(jobId, "dedupe", "active");
  const igDeduped = filterPreviouslySeen(dedupeCandidates(ig.candidates), priorIds);
  const metaDeduped = filterPreviouslySeen(dedupeCandidates(meta.candidates), priorIds);
  pushProgress(jobId, "dedupe", "done", `${igDeduped.length} ig / ${metaDeduped.length} meta after dedupe`);

  // 6. Text filter before expensive vision calls.
  pushProgress(jobId, "text_filter", "active");
  const igTextScored = scoreAndFilter(igDeduped, identity);
  const metaTextScored = scoreAndFilter(metaDeduped, identity);
  pushProgress(
    jobId,
    "text_filter",
    "done",
    `${igTextScored.length} ig / ${metaTextScored.length} meta passed threshold`
  );

  // 7. Visual verification (capped, progressive filtering to control cost).
  pushProgress(jobId, "visual_verification", "active");
  const igVerified = await verifyBatch(igTextScored.slice(0, MAX_VISUAL_VERIFICATIONS_PER_SOURCE), identity);
  const metaVerified = await verifyBatch(metaTextScored.slice(0, MAX_VISUAL_VERIFICATIONS_PER_SOURCE), identity);
  pushProgress(jobId, "visual_verification", "done");

  // 8. Reject low-confidence, then rank.
  pushProgress(jobId, "ranking", "active");
  const igAccepted = igVerified.filter((c) => c.verification?.sameProduct);
  const metaAccepted = metaVerified.filter((c) => c.verification?.sameProduct);

  const igRanked = rankCandidates(igAccepted).slice(0, PER_SOURCE_MINIMUM);
  const metaRanked = rankCandidates(metaAccepted).slice(0, PER_SOURCE_MINIMUM);
  pushProgress(jobId, "ranking", "done", `${igRanked.length} ig / ${metaRanked.length} meta final`);

  // 9. Persist.
  await persistCandidates(jobDoc._id, productDoc._id, [...igRanked, ...metaRanked]);

  const igProviderStatus = ig.status;
  const metaProviderStatus = meta.status;
  const overallStatus =
    igProviderStatus === "failed" && metaProviderStatus === "failed"
      ? "failed"
      : igRanked.length < PER_SOURCE_MINIMUM || metaRanked.length < PER_SOURCE_MINIMUM || igProviderStatus !== "ok" || metaProviderStatus !== "ok"
      ? "partial_success"
      : "completed";

  await DiscoveryJobModel.findOneAndUpdate(
    { jobId },
    {
      status: overallStatus,
      instagramStatus: igProviderStatus,
      metaAdsStatus: metaProviderStatus,
      instagramCount: igRanked.length,
      metaAdsCount: metaRanked.length,
    }
  );

  job.status = overallStatus;

  (job as any).results = {
    product: identity,
    instagram: { candidates: igRanked, status: igProviderStatus, error: ig.error, shortfallReason: shortfallReason(igRanked.length, igProviderStatus) },
    metaAds: { candidates: metaRanked, status: metaProviderStatus, error: meta.error, shortfallReason: shortfallReason(metaRanked.length, metaProviderStatus) },
  };
}

function shortfallReason(count: number, status: string): string | null {
  if (count >= PER_SOURCE_MINIMUM) return null;
  if (status === "failed") return "Provider request failed - see error for details.";
  return `Only ${count} high-confidence matches found after text + visual verification; ` +
    `widening queries or lowering the confidence threshold would surface more, lower-quality candidates.`;
}

function scoreAndFilter(candidates: NormalizedCandidate[], identity: any): NormalizedCandidate[] {
  return candidates
    .map((c) => ({ ...c, textScore: scoreTextMatch(c, identity) }))
    .filter((c) => (c.textScore ?? 0) >= TEXT_FILTER_THRESHOLD)
    .sort((a, b) => (b.textScore ?? 0) - (a.textScore ?? 0));
}

async function verifyBatch(candidates: NormalizedCandidate[], identity: any): Promise<NormalizedCandidate[]> {
  const settled = await Promise.allSettled(
    candidates.map(async (c): Promise<NormalizedCandidate> => ({ ...c, verification: await verifyCandidate(c, identity) }))
  );
  const out: NormalizedCandidate[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") out.push(r.value);
  }
  return out;
}

async function persistCandidates(jobObjectId: any, productObjectId: any, candidates: NormalizedCandidate[]) {
  if (!candidates.length) return;
  await VideoCandidateModel.insertMany(
    candidates.map((c) => ({
      job: jobObjectId,
      product: productObjectId,
      externalId: c.externalId,
      platform: c.platform,
      url: c.url,
      thumbnailUrl: c.thumbnailUrl,
      title: c.title,
      caption: c.caption,
      creator: c.creator,
      metadata: c.metadata,
      sourceQuery: c.sourceQuery,
      textScore: c.textScore,
      visualScore: c.visualScore,
      metadataScore: c.metadataScore,
      finalScore: c.finalScore,
      verification: c.verification,
      retrievedAt: c.retrievedAt,
    })),
    { ordered: false }
  ).catch((err) => logger.warn("Some candidates failed to persist", { error: err.message }));
}

export function getJobResult(jobId: string) {
  return (jobs.get(jobId) as any)?.results;
}
