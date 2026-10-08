import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { ShortlistItemModel, ShortlistItemDoc } from "../models/ShortlistItem";
import { isDbReady } from "../db/connection";

const itemSchema = z.object({
  key: z.string().min(3).max(200),
  platform: z.enum(["instagram", "meta_ads", "tiktok"]),
  url: z.string().url().max(2000),
  thumbId: z.string().regex(/^[a-f0-9]{40}$/).optional(),
  caption: z.string().max(5000).optional(),
  creator: z.string().max(300).optional(),
  score: z.number().min(0).max(100).optional(),
  reason: z.string().max(1000).optional(),
  productTitle: z.string().max(300).optional(),
  jobId: z.string().max(40).optional(),
});

// In-memory fallback when MongoDB is unavailable.
const memory = new Map<string, ShortlistItemDoc>();

async function all(): Promise<ShortlistItemDoc[]> {
  if (isDbReady()) return ShortlistItemModel.find().sort({ createdAt: -1 }).lean();
  return [...memory.values()].sort((a, b) => +b.createdAt - +a.createdAt);
}

export async function listShortlist(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ items: await all() });
  } catch (err) {
    next(err);
  }
}

export async function addToShortlist(req: Request, res: Response, next: NextFunction) {
  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", message: parsed.error.issues[0]?.message });
  try {
    if (isDbReady()) await ShortlistItemModel.updateOne({ key: parsed.data.key }, { $set: parsed.data }, { upsert: true });
    else memory.set(parsed.data.key, { ...parsed.data, createdAt: new Date() });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function removeFromShortlist(req: Request, res: Response, next: NextFunction) {
  try {
    if (isDbReady()) await ShortlistItemModel.deleteOne({ key: req.params.key });
    else memory.delete(req.params.key);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

const csvCell = (v: unknown) => {
  let s = v === undefined || v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // block spreadsheet formula injection
  return `"${s.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
};

/** GET /api/shortlist/export?format=csv|json */
export async function exportShortlist(req: Request, res: Response, next: NextFunction) {
  try {
    const items = await all();
    const stamp = new Date().toISOString().slice(0, 10);
    if (req.query.format === "json") {
      res.setHeader("Content-Disposition", `attachment; filename="video-shortlist-${stamp}.json"`);
      return res.json(items.map(({ thumbId, ...rest }: any) => ({ ...rest, _id: undefined, __v: undefined })));
    }
    const cols = ["platform", "url", "score", "reason", "creator", "caption", "productTitle", "createdAt"] as const;
    const csv = [cols.join(","), ...items.map((i: any) => cols.map((c) => csvCell(c === "createdAt" ? new Date(i[c]).toISOString() : i[c])).join(","))].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="video-shortlist-${stamp}.csv"`);
    res.send("﻿" + csv);
  } catch (err) {
    next(err);
  }
}
