/**
 * Fixed-window counters kept in process memory.
 *
 * Enough for a single Node instance (the MVP deployment). With several
 * instances each one enforces its own limit, so a multi-instance deployment
 * should add a shared limiter (gateway, Redis) in front.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Count one attempt. Returns 0 when allowed, otherwise the milliseconds until the window resets. A limit of 0 disables the limiter. */
  consume(key: string): number {
    if (this.limit <= 0) return 0;
    const now = this.now();
    this.sweep(now);
    const entry = this.windows.get(key);
    if (!entry || entry.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return 0;
    }
    entry.count += 1;
    return entry.count > this.limit ? entry.resetAt - now : 0;
  }

  /** Attempts counted for `key` in the current window. */
  count(key: string): number {
    const entry = this.windows.get(key);
    return entry && entry.resetAt > this.now() ? entry.count : 0;
  }

  /** Milliseconds until `key` may try again (0 when not limited), without counting an attempt. */
  peek(key: string): number {
    if (this.limit <= 0) return 0;
    const entry = this.windows.get(key);
    const now = this.now();
    return entry && entry.resetAt > now && entry.count >= this.limit ? entry.resetAt - now : 0;
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  /** Number of tracked keys (for tests). */
  get size(): number {
    return this.windows.size;
  }

  private sweep(now: number) {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [key, entry] of this.windows) if (entry.resetAt <= now) this.windows.delete(key);
  }
}

const globalForLimits = globalThis as unknown as { __ccrRateLimiters?: Map<string, RateLimiter> };

/** Process-wide named limiter, shared by route handlers, server actions and Auth.js. */
export function namedLimiter(name: string, limit: number, windowMs: number): RateLimiter {
  const registry = (globalForLimits.__ccrRateLimiters ??= new Map());
  let limiter = registry.get(name);
  if (!limiter || limiter.limit !== limit || limiter.windowMs !== windowMs) {
    limiter = new RateLimiter(limit, windowMs);
    registry.set(name, limiter);
  }
  return limiter;
}

/** Integer from the environment, falling back when unset or invalid. */
export function envLimit(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Client address from proxy headers, or null when unknown (never a shared fallback key). */
export function clientAddress(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || null;
}

export function retryText(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return seconds < 90 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`;
}
