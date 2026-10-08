/**
 * Minimal promise concurrency limiter: at most `max` tasks run at once, the
 * rest wait in FIFO order. Used to stay inside Gemini / Apify rate limits.
 */
export function createLimiter(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];

  const next = () => {
    if (active >= max) return;
    const start = waiting.shift();
    if (start) start();
  };

  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      };
      waiting.push(run);
      next();
    });
  };
}

/** Runs `fn` over `items` with a concurrency cap, preserving input order. Rejections become `null`. */
export async function mapLimit<T, R>(items: T[], max: number, fn: (item: T, index: number) => Promise<R>): Promise<(R | null)[]> {
  const limit = createLimiter(max);
  return Promise.all(items.map((item, i) => limit(() => fn(item, i)).catch(() => null)));
}
