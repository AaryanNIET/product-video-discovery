import { Request, Response } from "express";
import { Readable } from "stream";
import { isValidMediaId, refImagePath, thumbPath } from "../services/media/imageStore";

const CACHE = "public, max-age=604800, immutable";

export function getThumb(req: Request, res: Response) {
  if (!isValidMediaId(req.params.id)) return res.status(400).end();
  res.setHeader("Cache-Control", CACHE);
  res.sendFile(thumbPath(req.params.id), (err) => err && !res.headersSent && res.status(404).end());
}

export function getReference(req: Request, res: Response) {
  if (!isValidMediaId(req.params.id)) return res.status(400).end();
  res.setHeader("Cache-Control", CACHE);
  res.sendFile(refImagePath(req.params.id), (err) => err && !res.headersSent && res.status(404).end());
}

/**
 * Only platform video CDNs may be proxied. This is not a general-purpose proxy:
 * any other host is refused, which keeps the endpoint from being used for SSRF.
 */
const ALLOWED_VIDEO_HOSTS = [/\.cdninstagram\.com$/i, /\.fbcdn\.net$/i];

/**
 * GET /api/media/video?url=... streams an Instagram/Meta video for inline
 * playback. Their CDNs refuse cross-site embedding, so the browser cannot play
 * the raw URL directly. Range requests are passed through so seeking works.
 */
export async function proxyVideo(req: Request, res: Response) {
  let url: URL;
  try {
    url = new URL(String(req.query.url || ""));
  } catch {
    return res.status(400).json({ error: "invalid_url" });
  }
  if (url.protocol !== "https:" || !ALLOWED_VIDEO_HOSTS.some((re) => re.test(url.hostname))) {
    return res.status(403).json({ error: "host_not_allowed" });
  }

  try {
    const upstream = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", ...(req.headers.range ? { Range: String(req.headers.range) } : {}) },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!upstream.ok && upstream.status !== 206) return res.status(upstream.status === 403 ? 410 : 502).json({ error: "video_unavailable", message: "The video link has expired. Open the original post instead." });
    res.status(upstream.status);
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!String(upstream.headers.get("content-type")).startsWith("video/")) return res.status(415).end();
    Readable.fromWeb(upstream.body as any).pipe(res);
  } catch {
    if (!res.headersSent) res.status(502).json({ error: "video_unavailable" });
  }
}
