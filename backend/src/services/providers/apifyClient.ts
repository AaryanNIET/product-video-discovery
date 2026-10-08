import { env } from "../../config/env";
import { createLimiter } from "../../utils/concurrency";
import { withRetry } from "../../utils/retry";
import { logger } from "../../utils/logger";

export class ApifyError extends Error {
  constructor(message: string, public httpStatus?: number, public retryable = false) {
    super(message);
  }
}

// Apify's free plan allows a limited number of concurrent runs; stay well under it.
const limit = createLimiter(4);

/** Translates Apify HTTP errors into messages that tell the user what to do next. */
function explain(status: number, body: any, actor: string): ApifyError {
  const detail = body?.error?.message || body?.error?.type || "";
  switch (status) {
    case 401:
      return new ApifyError("Apify rejected the token. Check APIFY_TOKEN in backend/.env.", status);
    case 402:
      return new ApifyError("Apify account is out of credit for this month. Top up or wait for the monthly reset.", status);
    case 403:
      return new ApifyError(`Apify refused to run ${actor} (${detail || "forbidden"}). The actor may need to be rented/started once in the Apify Console.`, status);
    case 404:
      return new ApifyError(`Apify actor ${actor} was not found. Check the APIFY_*_ACTOR setting.`, status);
    case 408:
      return new ApifyError(`The ${actor} run timed out on Apify; the platform may be slow or blocking. Partial data was discarded.`, status, true);
    case 429:
      return new ApifyError("Apify rate limit reached; retrying shortly.", status, true);
    default:
      return new ApifyError(`Apify ${actor} failed with HTTP ${status}${detail ? `: ${detail}` : ""}`, status, status >= 500);
  }
}

/**
 * Runs an Apify actor synchronously and returns its dataset items. Apify runs
 * the browser/proxy side (rotating residential proxies, login walls, retries
 * on blocked pages), so this service only deals with clean JSON.
 */
export async function runActor<T = any>(actor: string, input: object, timeoutSec = env.apify.runTimeoutSec): Promise<T[]> {
  if (!env.apify.token) throw new ApifyError("APIFY_TOKEN is not configured in backend/.env");

  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actor).replace("%7E", "~")}/run-sync-get-dataset-items?timeout=${timeoutSec}&clean=true`;

  return limit(() =>
    withRetry(
      async () => {
        const started = Date.now();
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.apify.token}` },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout((timeoutSec + 30) * 1000),
        });
        const body: any = await res.json().catch(() => null);
        if (!res.ok) throw explain(res.status, body, actor);
        const items = Array.isArray(body) ? body : [];
        logger.info("Apify run finished", { actor, items: items.length, ms: Date.now() - started });
        return items as T[];
      },
      {
        retries: 1,
        timeoutMs: (timeoutSec + 40) * 1000,
        baseDelayMs: 3000,
        shouldRetry: (err) => (err instanceof ApifyError ? err.retryable : true),
      }
    )
  );
}

/** Reads the first defined value among several possible field paths (actors mix camelCase and snake_case). */
export function pick(obj: any, ...paths: string[]): any {
  for (const p of paths) {
    const v = p.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

export function toIso(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(v));
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}
