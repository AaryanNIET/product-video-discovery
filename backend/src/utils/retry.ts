export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  /** Return false to stop retrying (e.g. 401/402 errors that will never succeed). */
  shouldRetry?: (err: unknown) => boolean;
}

export class TimeoutError extends Error {
  constructor(message = "Operation timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(`Timed out after ${ms}ms`)), ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/** Errors may carry a server-suggested wait (e.g. HTTP 429 Retry-After), in ms. */
export interface RetryAfterError extends Error {
  retryAfterMs?: number;
}

/**
 * Exponential backoff retry wrapper with a hard cap on attempts and an
 * optional per-attempt timeout. Never retries indefinitely.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 3, baseDelayMs = 300, maxDelayMs = 4000, timeoutMs = 8000, shouldRetry } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs);
    } catch (err) {
      lastError = err;
      if (attempt === retries || (shouldRetry && !shouldRetry(err))) break;
      const hinted = (err as RetryAfterError)?.retryAfterMs;
      const delay = hinted ?? Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}
