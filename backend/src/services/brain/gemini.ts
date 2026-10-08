import { env } from "../../config/env";
import { createLimiter } from "../../utils/concurrency";
import { RetryAfterError, withRetry } from "../../utils/retry";
import { logger } from "../../utils/logger";

export type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

export class GeminiError extends Error implements RetryAfterError {
  retryAfterMs?: number;
  /** The model can't serve us today (daily quota used up) or at all (retired): switch models instead of retrying. */
  switchModel = false;
  constructor(message: string, public httpStatus?: number) {
    super(message);
  }
}

const limit = createLimiter(Math.max(1, env.gemini.concurrency));

export const isGeminiConfigured = () => Boolean(env.gemini.apiKey);

export const imagePart = (jpeg: Buffer): GeminiPart => ({ inline_data: { mime_type: "image/jpeg", data: jpeg.toString("base64") } });

/** Primary model first, then fallbacks (each model has its own quota on the Gemini API). */
const models = [...new Set([env.gemini.model, ...env.gemini.fallbackModels])];
/** model -> time (ms) until which it should not be used. */
const unavailableUntil = new Map<string, number>();

function currentModel(): string | undefined {
  return models.find((m) => (unavailableUntil.get(m) ?? 0) <= Date.now());
}

/** Parses "retry in 12.5s" style hints from Gemini 429 responses. */
function retryDelayFrom(body: any): number | undefined {
  const details: any[] = body?.error?.details || [];
  const info = details.find((d) => String(d["@type"] || "").includes("RetryInfo"));
  const secs = parseFloat(String(info?.retryDelay || "").replace("s", ""));
  return Number.isFinite(secs) ? Math.min(60_000, Math.ceil(secs * 1000)) : undefined;
}

function isDailyQuota(body: any): boolean {
  const details: any[] = body?.error?.details || [];
  return details.some((d) => (d.violations || []).some((v: any) => /PerDay/i.test(String(v.quotaId || ""))));
}

async function callModel<T>(model: string, body: object): Promise<T> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.gemini.apiKey },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new GeminiError(`Gemini ${model} ${res.status}: ${json?.error?.message || res.statusText}`, res.status);
    if (res.status === 429 && isDailyQuota(json)) {
      err.switchModel = true;
      unavailableUntil.set(model, Date.now() + 6 * 3600_000); // re-check later; daily quotas reset at midnight Pacific
    } else if (res.status === 404) {
      err.switchModel = true; // retired or unknown model
      unavailableUntil.set(model, Number.MAX_SAFE_INTEGER);
    } else if (res.status === 429) {
      err.retryAfterMs = retryDelayFrom(json) ?? 15_000;
    }
    if (err.switchModel) logger.warn("Gemini model unavailable, switching to the next model", { model, status: res.status, next: currentModel() || null });
    else if (res.status === 429) logger.warn("Gemini rate limit hit, backing off", { model, waitMs: err.retryAfterMs });
    throw err;
  }
  const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") || "";
  if (!text) throw new GeminiError(`Gemini ${model} returned no content (${json?.candidates?.[0]?.finishReason || "unknown"})`);
  return JSON.parse(text) as T;
}

/**
 * Calls Gemini generateContent and returns the parsed JSON reply. A response
 * schema forces well-formed JSON and temperature 0 keeps scoring repeatable.
 * Per-minute 429s and 5xx are retried with the server's suggested delay; a
 * model that is out of daily quota or retired is skipped for the next one in
 * GEMINI_FALLBACK_MODELS.
 */
export async function generateJson<T>(parts: GeminiPart[], responseSchema: object, systemInstruction: string): Promise<T> {
  if (!env.gemini.apiKey) throw new GeminiError("GEMINI_API_KEY is not configured");

  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema },
  };

  return limit(async () => {
    for (;;) {
      const model = currentModel();
      if (!model) throw new GeminiError(`All Gemini models (${models.join(", ")}) are out of quota or unavailable. Enable billing in Google AI Studio or try again tomorrow.`, 429);
      try {
        return await withRetry(() => callModel<T>(model, body), {
          retries: 2,
          timeoutMs: 90_000,
          baseDelayMs: 3000,
          maxDelayMs: 20_000,
          // Bad key / bad request will never succeed; quota/retired models switch instead of retrying.
          shouldRetry: (err) => {
            const e = err as GeminiError;
            return !e.switchModel && (!e.httpStatus || e.httpStatus === 429 || e.httpStatus >= 500);
          },
        });
      } catch (err) {
        const e = err as GeminiError;
        if (e.switchModel) continue;
        // Still overloaded or rate-limited after retries: rest this model briefly and try the next one.
        if (e.httpStatus === 429 || (e.httpStatus ?? 0) >= 500) {
          unavailableUntil.set(model, Date.now() + 2 * 60_000);
          logger.warn("Gemini model overloaded, trying the next model", { model, status: e.httpStatus, next: currentModel() || null });
          continue;
        }
        throw err;
      }
    }
  });
}

/** Model that will serve the next request (for the health endpoint). */
export const activeGeminiModel = () => currentModel() || null;
