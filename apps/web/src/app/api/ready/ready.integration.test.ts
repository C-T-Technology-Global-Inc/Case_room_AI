import { prisma } from "@ccr/database";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

/** Readiness against the integration database (round 4, finding 2). */
const activeReadinessQueries = async () => {
  const rows = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'ccr-readiness'`;
  return rows[0]?.n ?? 0;
};

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "integration-test-placeholder");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/ready", () => {
  it("is ready when the database answers and migrations are complete", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
  });

  it("is not ready without AUTH_SECRET", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    expect((await GET()).status).toBe(503);
  });

  it("answers 503 quickly when the database is blocked, leaves no queries behind and never drains the app pool", async () => {
    const blocker = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query('LOCK TABLE "_prisma_migrations" IN ACCESS EXCLUSIVE MODE');

      const started = Date.now();
      const responses = await Promise.all(Array.from({ length: 12 }, () => GET()));
      expect(responses.every((response) => response.status === 503)).toBe(true);
      expect(Date.now() - started).toBeLessThan(4_000);

      // The database cancelled the probe query (lock_timeout) and its connection is closed.
      for (let i = 0; i < 50 && (await activeReadinessQueries()) > 0; i++) await new Promise((r) => setTimeout(r, 50));
      expect(await activeReadinessQueries()).toBe(0);

      // While the lock is still held, ordinary application queries are not stuck behind probes.
      await expect(prisma.user.count()).resolves.toBeTypeOf("number");
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      await blocker.end();
    }
    expect((await GET()).status).toBe(200);
  });
});
