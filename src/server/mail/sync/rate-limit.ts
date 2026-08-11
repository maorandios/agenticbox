export class RateLimitError extends Error {
  retryAfterMs: number;

  constructor(retryAfterMs: number, message = "rate_limited") {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export function parseRetryAfterMs(error: unknown): number | null {
  const err = error as {
    statusCode?: number;
    status?: number;
    headers?: Record<string, string>;
    response?: { headers?: Record<string, string>; status?: number };
  };

  const status = err?.statusCode ?? err?.status ?? err?.response?.status;
  if (status !== 429) return null;

  const headers = err?.headers ?? err?.response?.headers ?? {};
  const raw =
    headers["retry-after"] ??
    headers["Retry-After"] ??
    headers["x-retry-after"];
  if (!raw) return 5000;
  const asNum = Number(raw);
  if (!Number.isNaN(asNum)) {
    return asNum < 100 ? asNum * 1000 : asNum;
  }
  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return 5000;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withNylasRetry<T>(
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; onRetry?: (attempt: number, waitMs: number) => void },
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 4;
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      const waitMs = parseRetryAfterMs(error);
      if (waitMs == null || attempt >= maxAttempts) {
        throw error;
      }
      opts?.onRetry?.(attempt, waitMs);
      await sleep(waitMs);
    }
  }
}

/** Run async tasks with a fixed concurrency bound. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let next = 0;

  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!, index);
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => run(),
  );
  await Promise.all(runners);
  return results;
}
