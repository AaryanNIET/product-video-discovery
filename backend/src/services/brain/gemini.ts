import { env } from "../../config/env";
import { createLimiter } from "../../utils/concurrency";
import { RetryAfterError, withRetry } from "../../utils/retry";
import { logger } from "../../utils/logger";

export type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

export class GeminiError extends Error implements RetryAfterError {
  retryAfterMs?: number;
  constructor(message: string, public httpStatus?: number) {
    super(message);
  }
}

const limit = createLimiter(Math.max(1, env.gemini.concurrency));

export const isGeminiConfigured = () => Boolean(env.gemini.apiKey);

export const imagePart = (jpeg: Buffer): GeminiPart => ({ inline_data: { mime_type: "image/jpeg", data: jpeg.toString("base64") } });

/** Parses "retry in 12.5s" style hints from Gemini 429 responses. */
function retryDelayFrom(body: any): number | undefined {
  const details: any[] = body?.error?.details || [];
  const info = details.find((d) => String(d["@type"] || "").includes("RetryInfo"));
  const secs = parseFloat(String(info?.retryDelay || "").replace("s", ""));
  return Number.isFinite(secs) ? Math.min(60_000, Math.ceil(secs * 1000)) : undefined;
}

/**
 * Calls Gemini generateContent and returns the parsed JSON reply. A response
 * schema forces well-formed JSON, temperature 0 keeps scoring repeatable, and
 * 429/5xx responses are retried with the server's suggested delay.
 */
export async function generateJson<T>(parts: GeminiPart[], responseSchema: object, systemInstruction: string): Promise<T> {
  if (!env.gemini.apiKey) throw new GeminiError("GEMINI_API_KEY is not configured");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.gemini.model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema,
    },
  };

  return limit(() =>
    withRetry(
      async () => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": env.gemini.apiKey },
          body: JSON.stringify(body),
        });
        const json: any = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err = new GeminiError(`Gemini ${res.status}: ${json?.error?.message || res.statusText}`, res.status);
          err.retryAfterMs = res.status === 429 ? retryDelayFrom(json) ?? 15_000 : undefined;
          if (res.status === 429) logger.warn("Gemini rate limit hit, backing off", { waitMs: err.retryAfterMs });
          throw err;
        }
        const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") || "";
        if (!text) throw new GeminiError(`Gemini returned no content (${json?.candidates?.[0]?.finishReason || "unknown"})`);
        return JSON.parse(text) as T;
      },
      {
        retries: 4,
        timeoutMs: 60_000,
        baseDelayMs: 2000,
        maxDelayMs: 30_000,
        // Bad key / bad request / bad model name will never succeed: fail fast.
        shouldRetry: (err) => {
          const s = (err as GeminiError).httpStatus;
          return !s || s === 429 || s >= 500;
        },
      }
    )
  );
}
