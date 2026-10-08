import { EventEmitter } from "events";
import { nanoid } from "nanoid";
import { JobStatus, Platform, ProductIdentity, ProgressStep, SourceSummary } from "../../types";
import { SearchJobModel } from "../../models/SearchJob";
import { isDbReady } from "../../db/connection";
import { logger } from "../../utils/logger";
import { env } from "../../config/env";

export interface Job {
  jobId: string;
  input: string;
  hasUpload: boolean;
  includeTikTok: boolean;
  status: JobStatus;
  progress: ProgressStep[];
  product: ProductIdentity | null;
  sources: Partial<Record<Platform, SourceSummary>>;
  error?: string;
  createdAt: string;
  events: EventEmitter;
}

const jobs = new Map<string, Job>();

/** JSON-safe view of a job (what the API and SSE stream send). */
export function serializeJob(job: Omit<Job, "events">) {
  const stripRaw = (s?: SourceSummary) =>
    s && {
      ...s,
      accepted: s.accepted.map(({ raw, ...c }) => c),
      belowThreshold: s.belowThreshold.map(({ raw, ...c }) => c),
      previouslySeen: s.previouslySeen.map(({ raw, ...c }) => c),
    };
  return {
    jobId: job.jobId,
    input: job.input,
    hasUpload: job.hasUpload,
    includeTikTok: job.includeTikTok,
    status: job.status,
    progress: job.progress,
    product: job.product,
    sources: Object.fromEntries(Object.entries(job.sources).map(([k, v]) => [k, stripRaw(v)])),
    error: job.error,
    createdAt: job.createdAt,
    minimumPerSource: env.matching.perSourceMinimum,
    matchThreshold: env.matching.threshold,
  };
}

export function createJob(input: string, hasUpload: boolean, includeTikTok: boolean): Job {
  const job: Job = {
    jobId: nanoid(12),
    input,
    hasUpload,
    includeTikTok,
    status: "queued",
    progress: [],
    product: null,
    sources: {},
    createdAt: new Date().toISOString(),
    events: new EventEmitter(),
  };
  job.events.setMaxListeners(50);
  jobs.set(job.jobId, job);
  persist(job);
  return job;
}

export function getLiveJob(jobId: string): Job | undefined {
  return jobs.get(jobId);
}

/** Live job from memory, or a finished one from MongoDB (e.g. opened from history after a restart). */
export async function findJob(jobId: string) {
  const live = jobs.get(jobId);
  if (live) return serializeJob(live);
  if (!isDbReady()) return null;
  const doc = await SearchJobModel.findOne({ jobId }).lean();
  if (!doc) return null;
  return serializeJob({ ...doc, product: doc.product, sources: doc.sources as any, createdAt: doc.createdAt.toISOString() } as any);
}

export function setProgress(job: Job, step: string, status: ProgressStep["status"], detail?: string) {
  job.progress = job.progress.filter((p) => p.step !== step);
  job.progress.push({ step, status, detail, at: new Date().toISOString() });
  logger.info(`job:${job.jobId} ${step} -> ${status}`, detail ? { detail } : undefined);
  emit(job);
}

/** Notify SSE subscribers (throttled so a burst of updates becomes one message). */
const pending = new Set<string>();
export function emit(job: Job) {
  if (pending.has(job.jobId)) return;
  pending.add(job.jobId);
  setTimeout(() => {
    pending.delete(job.jobId);
    job.events.emit("update", serializeJob(job));
  }, 150);
}

export async function persist(job: Job) {
  if (!isDbReady()) return;
  const { events, ...data } = serializeJob(job) as any;
  await SearchJobModel.updateOne({ jobId: job.jobId }, { $set: data }, { upsert: true }).catch((err) =>
    logger.warn("Could not persist job", { jobId: job.jobId, error: err.message })
  );
}

export function finishJob(job: Job, status: JobStatus, error?: string) {
  job.status = status;
  if (error) job.error = error;
  emit(job);
  persist(job);
  job.events.emit("end");
  // Keep finished jobs in memory briefly for fast polling, then rely on MongoDB.
  setTimeout(() => jobs.delete(job.jobId), isDbReady() ? 30 * 60_000 : 24 * 3600_000).unref();
}

export async function listHistory(limit = 50) {
  const live = [...jobs.values()];
  const fromDb = isDbReady() ? await SearchJobModel.find().sort({ createdAt: -1 }).limit(limit).lean() : [];
  const seen = new Set<string>();
  const rows = [...live.map((j) => ({ ...j, createdAt: j.createdAt })), ...fromDb.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }))]
    .filter((j: any) => (seen.has(j.jobId) ? false : (seen.add(j.jobId), true)))
    .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);

  return rows.map((j: any) => ({
    jobId: j.jobId,
    input: j.input,
    hasUpload: j.hasUpload,
    status: j.status,
    title: j.product?.title || j.input || "Image search",
    imageId: j.product?.imageId || null,
    counts: Object.fromEntries(Object.entries(j.sources || {}).map(([k, v]: [string, any]) => [k, v?.accepted?.length ?? 0])),
    createdAt: j.createdAt,
  }));
}

// ---- Job queue -------------------------------------------------------------
// Searches run in the background, a few at a time, so a long scrape never
// blocks the HTTP request and bursts of searches cannot exhaust the scraper or
// vision quotas. (Production: swap for BullMQ + Redis to survive restarts.)

type Task = () => Promise<void>;
const queue: Array<{ job: Job; task: Task }> = [];
let running = 0;

export function enqueue(job: Job, task: Task) {
  queue.push({ job, task });
  queue.forEach((q, i) => setProgress(q.job, "queued", "active", i === 0 && running < env.jobs.maxConcurrent ? "Starting" : `Waiting: ${i + 1} search(es) ahead`));
  drain();
}

function drain() {
  while (running < env.jobs.maxConcurrent && queue.length) {
    const { job, task } = queue.shift()!;
    running++;
    job.status = "running";
    setProgress(job, "queued", "done");
    task()
      .catch((err) => {
        logger.error("Search job crashed", { jobId: job.jobId, error: (err as Error).message });
        finishJob(job, "failed", (err as Error).message);
      })
      .finally(() => {
        running--;
        drain();
      });
  }
}
