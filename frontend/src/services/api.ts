import axios from "axios";
import { Health, HistoryItem, SearchJob, ShortlistItem, VideoCandidate } from "../types";

/** Same-origin "/api" by default: Vite proxies it in dev and nginx proxies it in Docker. */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "/api";

const client = axios.create({ baseURL: API_BASE, timeout: 30000 });

/** Turns any API error into one human-readable sentence. */
export function errorMessage(err: unknown, fallback = "Something went wrong."): string {
  const e = err as any;
  if (e?.response?.data?.message) return e.response.data.message;
  if (e?.code === "ERR_NETWORK") return "Cannot reach the backend. Is it running on port 4000?";
  return e?.message || fallback;
}

export async function startSearch(body: { input: string; imageDataUrl?: string; includeTikTok: boolean }): Promise<string> {
  const res = await client.post("/search", body);
  return res.data.jobId;
}

export const getSearch = async (jobId: string): Promise<SearchJob> => (await client.get(`/search/${jobId}`)).data;
export const getHistory = async (): Promise<HistoryItem[]> => (await client.get("/history")).data.history;
export const getHealth = async (): Promise<Health> => (await client.get("/health")).data;

export const getShortlist = async (): Promise<ShortlistItem[]> => (await client.get("/shortlist")).data.items;
export const removeFromShortlist = (key: string) => client.delete(`/shortlist/${encodeURIComponent(key)}`);
export function addToShortlist(video: VideoCandidate, productTitle?: string, jobId?: string) {
  return client.post("/shortlist", {
    key: video.key,
    platform: video.platform,
    url: video.url,
    thumbId: video.thumbId,
    caption: video.caption?.slice(0, 5000),
    creator: video.creator,
    score: video.match?.score,
    reason: video.match?.reason,
    productTitle,
    jobId,
  });
}

export const exportUrl = (format: "csv" | "json") => `${API_BASE}/shortlist/export?format=${format}`;
export const thumbUrl = (id?: string) => (id ? `${API_BASE}/media/thumb/${id}` : undefined);
export const refImageUrl = (id?: string | null) => (id ? `${API_BASE}/media/ref/${id}` : undefined);
export const videoProxyUrl = (url: string) => `${API_BASE}/media/video?url=${encodeURIComponent(url)}`;

/**
 * Live progress via Server-Sent Events. Falls back to polling if the stream
 * cannot be opened or drops (corporate proxies sometimes buffer SSE).
 */
export function watchSearch(jobId: string, onUpdate: (job: SearchJob) => void, onError: (msg: string) => void): () => void {
  let closed = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  const done = (j: SearchJob) => ["completed", "partial", "failed"].includes(j.status);

  const poll = async () => {
    if (closed) return;
    try {
      const job = await getSearch(jobId);
      onUpdate(job);
      if (!done(job)) pollTimer = setTimeout(poll, 1500);
    } catch (err) {
      onError(errorMessage(err, "Lost connection while waiting for results."));
    }
  };

  const es = new EventSource(`${API_BASE}/search/${jobId}/events`);
  es.addEventListener("update", (e) => {
    const job = JSON.parse((e as MessageEvent).data) as SearchJob;
    finished = done(job);
    onUpdate(job);
  });
  es.addEventListener("end", () => {
    finished = true;
    es.close();
  });
  es.onerror = () => {
    es.close();
    if (!finished && !closed) poll();
  };

  return () => {
    closed = true;
    es.close();
    if (pollTimer) clearTimeout(pollTimer);
  };
}

/** Downscales an uploaded photo in the browser (max 1600px JPEG) so uploads stay small and fast. */
export async function fileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file (PNG, JPEG or WebP).");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.9);
}
