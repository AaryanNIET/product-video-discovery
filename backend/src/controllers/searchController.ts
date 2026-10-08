import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { createJob, enqueue, findJob, getLiveJob, listHistory } from "../services/pipeline/jobs";
import { runSearch } from "../services/pipeline/searchPipeline";
import { decodeImageDataUrl } from "../services/media/imageStore";
import { assertPublicUrl } from "../utils/safeFetch";
import { isUrlInput } from "../services/product/productResolver";

const searchSchema = z
  .object({
    input: z.string().trim().max(2000).default(""),
    imageDataUrl: z.string().max(9_000_000).optional(),
    includeTikTok: z.boolean().default(false),
  })
  .refine((b) => b.input.length >= 2 || b.imageDataUrl, { message: "Enter a product name or link, or upload a product image." });

/** POST /api/search: validates input, queues a background job, returns 202 + jobId immediately. */
export async function postSearch(req: Request, res: Response, next: NextFunction) {
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_error", message: parsed.error.issues[0]?.message || "Invalid input" });
  }
  const { input, imageDataUrl, includeTikTok } = parsed.data;

  try {
    // Reject unsafe links up front so the user gets a clear 400 instead of a failed job.
    if (isUrlInput(input)) await assertPublicUrl(input);
    const upload = imageDataUrl ? await decodeImageDataUrl(imageDataUrl) : null;

    const job = createJob(input, Boolean(upload), includeTikTok);
    enqueue(job, () => runSearch(job, upload));
    return res.status(202).json({ jobId: job.jobId });
  } catch (err: any) {
    if (err?.status === 400) return res.status(400).json({ error: "invalid_input", message: err.message });
    next(err);
  }
}

/** GET /api/search/:id: current state of a search (live or from history). */
export async function getSearch(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await findJob(req.params.id);
    if (!job) return res.status(404).json({ error: "not_found", message: "No search with that id." });
    res.json(job);
  } catch (err) {
    next(err);
  }
}

/** GET /api/search/:id/events: Server-Sent Events stream of progress and partial results. */
export async function streamSearch(req: Request, res: Response) {
  const snapshot = await findJob(req.params.id).catch(() => null);
  if (!snapshot) return res.status(404).json({ error: "not_found", message: "No search with that id." });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send("update", snapshot);

  const live = getLiveJob(req.params.id);
  if (!live || ["completed", "partial", "failed"].includes(live.status)) {
    send("end", {});
    return res.end();
  }

  const onUpdate = (data: unknown) => send("update", data);
  const onEnd = () => {
    // Let the final throttled update flush first.
    setTimeout(() => {
      send("end", {});
      res.end();
    }, 300);
  };
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
  live.events.on("update", onUpdate);
  live.events.once("end", onEnd);
  req.on("close", () => {
    clearInterval(heartbeat);
    live.events.off("update", onUpdate);
    live.events.off("end", onEnd);
  });
}

export async function getHistory(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ history: await listHistory() });
  } catch (err) {
    next(err);
  }
}
