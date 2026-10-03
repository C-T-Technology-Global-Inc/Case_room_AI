import { describe, expect, it } from "vitest";
import { clientAddress, RateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
  it("allows up to the limit per window, then reports the wait", () => {
    let now = 0;
    const limiter = new RateLimiter(3, 60_000, () => now);
    expect([limiter.consume("a"), limiter.consume("a"), limiter.consume("a")]).toEqual([0, 0, 0]);
    expect(limiter.consume("a")).toBe(60_000);
    expect(limiter.peek("a")).toBe(60_000);
    expect(limiter.consume("b")).toBe(0);
    now = 60_000;
    expect(limiter.consume("a")).toBe(0);
  });

  it("forgets expired keys so memory does not grow with every client", () => {
    let now = 0;
    const limiter = new RateLimiter(5, 1_000, () => now);
    for (let i = 0; i < 100; i++) limiter.consume(`client-${i}`);
    now = 2_000;
    limiter.consume("late");
    expect(limiter.size).toBe(1);
  });

  it("is disabled with a limit of 0", () => {
    const limiter = new RateLimiter(0, 1_000);
    for (let i = 0; i < 10; i++) expect(limiter.consume("a")).toBe(0);
  });
});

describe("clientAddress", () => {
  it("uses the first forwarded address and never invents a shared key", () => {
    expect(clientAddress(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientAddress(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientAddress(new Headers())).toBeNull();
  });
});
