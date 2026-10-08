import { Request, Response } from "express";
import { z } from "zod";
import { startDiscoveryJob, getJobProgress, getJobResult } from "../services/discoveryService";
import { DiscoveryJobModel } from "../models/DiscoveryJob";
import { ProductModel } from "../models/Product";
import { logger } from "../utils/logger";

const startSchema = z.object({
  input: z.string().min(2, "Enter a product name or a product URL").max(2000),
});

export async function postDiscovery(req: Request, res: Response) {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
  }

  try {
    const jobId = await startDiscoveryJob(parsed.data.input.trim());
    return res.status(202).json({ jobId });
  } catch (err) {
    logger.error("Failed to start discovery job", { error: (err as Error).message });
    return res.status(500).json({ error: "internal_error", message: "Could not start discovery job" });
  }
}

export async function getDiscovery(req: Request, res: Response) {
  const { jobId } = req.params;
  const inMemory = getJobProgress(jobId);

  if (!inMemory) {
    // Fall back to the durable Mongo record (e.g. after a server restart).
    const doc = await DiscoveryJobModel.findOne({ jobId });
    if (!doc) return res.status(404).json({ error: "not_found", message: "Unknown jobId" });
    return res.json({ jobId, status: doc.status, progress: [], results: null });
  }

  return res.json({
    jobId,
    status: inMemory.status,
    progress: inMemory.progress,
    results: getJobResult(jobId) || null,
  });
}

export async function getHistory(req: Request, res: Response) {
  const jobs = await DiscoveryJobModel.find().sort({ createdAt: -1 }).limit(50).populate("product");
  res.json({
    history: jobs.map((j) => ({
      jobId: j.jobId,
      status: j.status,
      productName: (j.product as any)?.productName,
      sourceInput: (j.product as any)?.sourceInput,
      instagramCount: j.instagramCount,
      metaAdsCount: j.metaAdsCount,
      createdAt: j.createdAt,
    })),
  });
}
