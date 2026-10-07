import pg from "pg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Readiness: AUTH_SECRET is set, the database answers and no migration is
 * half-applied. Used by load balancers and orchestrators to route traffic;
 * returns no internal details.
 *
 * The check never touches the application's connection pool: it opens one
 * short-lived connection with database-side timeouts (a blocked or slow query
 * is cancelled by PostgreSQL, not abandoned), and concurrent probes share the
 * check in flight, so probes cannot pile up queries or drain the pool.
 */
const CONNECT_TIMEOUT_MS = 1_500;
const STATEMENT_TIMEOUT_MS = 1_500;
const LOCK_TIMEOUT_MS = 1_000;

let inFlight: Promise<boolean> | null = null;

async function check(): Promise<boolean> {
  if (!process.env.AUTH_SECRET || !process.env.DATABASE_URL) return false;
  let client: pg.Client | null = null;
  try {
    // Inside the try: an invalid connection string must yield 503, not an unhandled error.
    client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      statement_timeout: STATEMENT_TIMEOUT_MS,
      lock_timeout: LOCK_TIMEOUT_MS,
      query_timeout: STATEMENT_TIMEOUT_MS + 500,
      application_name: "ccr-readiness",
    });
    client.on("error", () => undefined);
    await client.connect();
    const result = await client.query<{ unfinished: number }>(
      `SELECT count(*)::int AS unfinished FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
    );
    return result.rows[0]?.unfinished === 0;
  } catch (error) {
    console.warn("[ready]", error instanceof Error ? error.message : error);
    return false;
  } finally {
    await client?.end().catch(() => undefined);
  }
}

export async function GET() {
  inFlight ??= check().finally(() => {
    inFlight = null;
  });
  const ready = await inFlight;
  return Response.json(ready ? { status: "ready" } : { status: "unavailable" }, {
    status: ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
