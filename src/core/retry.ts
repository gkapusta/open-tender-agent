export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const canRetry = opts.shouldRetry ? opts.shouldRetry(error, attempt) : true;
      if (attempt === maxAttempts || !canRetry) {
        break;
      }
      const backoff = baseDelayMs * 2 ** (attempt - 1);
      const jitter = backoff * (0.5 + Math.random() * 0.5);
      await Bun.sleep(Math.floor(jitter));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export class RateLimiter {
  private readonly minIntervalMs: number;
  private last = 0;

  constructor(callsPerSecond: number) {
    this.minIntervalMs = Math.ceil(1000 / callsPerSecond);
  }

  async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.last;
    if (elapsed < this.minIntervalMs) {
      await Bun.sleep(this.minIntervalMs - elapsed);
    }
    this.last = Date.now();
  }
}

export async function humanDelay(minMs = 200, maxMs = 600): Promise<void> {
  const ms = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
  await Bun.sleep(ms);
}
