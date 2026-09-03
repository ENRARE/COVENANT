export type RateLimitRule = Readonly<{
  limit: number;
  windowMs: number;
}>;

export type RateLimitResult = Readonly<{
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}>;

type Bucket = { startedAt: number; count: number };

/** Bounded in-process limiter for a single developer-release instance. */
export class InMemoryRateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #now: () => number;
  readonly #maxBuckets: number;

  constructor(
    options: Readonly<{ now?: () => number; maxBuckets?: number }> = {},
  ) {
    this.#now = options.now ?? (() => Date.now());
    this.#maxBuckets = options.maxBuckets ?? 10_000;
  }

  consume(scope: string, key: string, rule: RateLimitRule): RateLimitResult {
    if (!Number.isSafeInteger(rule.limit) || rule.limit < 1)
      throw new Error("Rate limit must be a positive integer");
    if (!Number.isSafeInteger(rule.windowMs) || rule.windowMs < 1)
      throw new Error("Rate-limit window must be a positive integer");
    const now = this.#now();
    const bucketKey = `${scope}:${key}`;
    const previous = this.#buckets.get(bucketKey);
    const bucket =
      previous === undefined || now - previous.startedAt >= rule.windowMs
        ? { startedAt: now, count: 0 }
        : previous;
    bucket.count += 1;
    this.#buckets.set(bucketKey, bucket);
    this.#trim(now, rule.windowMs);
    const allowed = bucket.count <= rule.limit;
    return {
      allowed,
      remaining: Math.max(0, rule.limit - bucket.count),
      retryAfterMs: allowed
        ? 0
        : Math.max(1, rule.windowMs - (now - bucket.startedAt)),
    };
  }

  clear(): void {
    this.#buckets.clear();
  }

  #trim(now: number, windowMs: number): void {
    if (this.#buckets.size <= this.#maxBuckets) {
      for (const [key, bucket] of this.#buckets) {
        if (now - bucket.startedAt >= windowMs) this.#buckets.delete(key);
      }
      return;
    }
    const oldest = [...this.#buckets.entries()]
      .sort((left, right) => left[1].startedAt - right[1].startedAt)
      .slice(0, this.#buckets.size - this.#maxBuckets);
    for (const [key] of oldest) this.#buckets.delete(key);
  }
}
