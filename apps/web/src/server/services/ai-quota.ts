import "server-only";
import { Prisma, prisma, type TransactionClient } from "@ccr/database";
import type { SessionUser } from "../auth/session";
import { AppError, RateLimitError } from "../errors";
import { envLimit, namedLimiter, retryText } from "../rate-limit";
import { getAIProviderInfo } from "./ai";

/**
 * How long a reservation or a result transaction waits for a lock before giving
 * up (retryable). Keeps the deployment-wide reservation section and result
 * commits well inside the 5 s interactive transaction budget.
 */
const RESERVE_LOCK_TIMEOUT = "2s";
const COMMIT_LOCK_TIMEOUT = "3s";
/** How often a running job refreshes its heartbeat. */
export const AI_RUN_HEARTBEAT_MS = 30_000;
/**
 * A RESERVED run without a heartbeat for this long is presumed abandoned (its
 * process stopped). Liveness decides, not age: a slow job that keeps beating
 * keeps its concurrency slot however long it takes. Heartbeats and the sweep
 * both use the database clock, so clock skew between app servers does not matter.
 *
 * Presumed is not proven: a process that could not reach the database for two
 * minutes may still have a provider call in flight, so the concurrency cap is a
 * soft limit in that window. Such a run can never commit its results (see
 * completeAIRunInTransaction); cancelling the provider call itself is part of
 * the durable job queue (plan item 2.1).
 */
export const AI_RUN_STALE_MS = 2 * 60_000;

/**
 * The database clock as Prisma stores DateTime columns (timestamp without time
 * zone, in UTC). Plain now() would be interpreted in the session's time zone.
 */
const DB_UTC_NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

/** The run was closed (presumed abandoned) while this process still worked on it: nothing may be saved. */
export class AIRunLostError extends AppError {
  constructor() {
    super("This AI task was stopped because it stopped reporting progress, and its results were not saved. Please try again.");
    this.name = "AIRunLostError";
  }
}

export interface AIRunSpec {
  /** Short task name recorded on the run, e.g. "case_summary". */
  task: string;
  /** Model calls the job may make. */
  units?: number;
}

/**
 * Reserve AI budget before any model call (the provider key is shared by every
 * organization of the deployment). Reservations are serialized deployment-wide,
 * so concurrent requests cannot overshoot a limit, and every reserved run counts
 * except those released before dispatch. Limits (0 disables one):
 * - AI_REQUESTS_PER_USER_PER_MINUTE (default 12): burst per person, in memory;
 * - AI_DAILY_REQUESTS_PER_ORG (default 500): model calls per organization, rolling 24 h;
 * - AI_CONCURRENT_RUNS_PER_ORG (default 4): jobs running at once per organization;
 * - AI_DAILY_REQUESTS_TOTAL (default 0): model calls for the whole deployment, rolling 24 h.
 */
export async function reserveAIRun(user: SessionUser, spec: AIRunSpec): Promise<{ id: string }> {
  const units = spec.units ?? 1;
  // Per person (identity), so belonging to several organizations does not multiply the burst limit.
  const burst = namedLimiter("ai-user", envLimit("AI_REQUESTS_PER_USER_PER_MINUTE", 12), 60_000);
  const wait = burst.consume(user.identityId);
  if (wait) throw new RateLimitError(`You are sending AI requests too quickly. Try again in ${retryText(wait)}.`);

  const perOrganization = envLimit("AI_DAILY_REQUESTS_PER_ORG", 500);
  const concurrent = envLimit("AI_CONCURRENT_RUNS_PER_ORG", 4);
  const total = envLimit("AI_DAILY_REQUESTS_TOTAL", 0);
  return prisma.$transaction(async (tx) => {
    // Never wait long for a lock: this section is serialized for the whole deployment.
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${RESERVE_LOCK_TIMEOUT}'`);
    // One reservation at a time across the deployment; the transaction holds nothing else.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('ccr-ai-runs'))`;
    // Close runs presumed abandoned (database clock). They stay counted in the daily budget
    // (the model may have been called) but no longer hold a concurrency slot. A run locked by
    // a result transaction that is committing right now is skipped, not waited for: it stays
    // RESERVED and keeps its slot until it settles (conservative).
    await tx.$executeRaw`
      UPDATE "AIRun" SET status = 'FAILED', "finishedAt" = ${DB_UTC_NOW},
        error = 'Abandoned: no heartbeat for two minutes (the process running this job stopped or lost the database).'
      WHERE id IN (
        SELECT id FROM "AIRun"
        WHERE status = 'RESERVED' AND "heartbeatAt" < ${DB_UTC_NOW} - make_interval(secs => ${AI_RUN_STALE_MS / 1000})
        FOR UPDATE SKIP LOCKED
      )`;

    // Rolling 24-hour windows on the database clock, so app servers with skewed clocks agree.
    const unitsSince = async (organizationId: string | null) => {
      const rows = await tx.$queryRaw<Array<{ units: number }>>`
        SELECT COALESCE(SUM(units), 0)::int AS units FROM "AIRun"
        WHERE status <> 'RELEASED' AND "createdAt" >= ${DB_UTC_NOW} - interval '24 hours'
          ${organizationId ? Prisma.sql`AND "organizationId" = ${organizationId}` : Prisma.empty}`;
      return rows[0]?.units ?? 0;
    };

    if (perOrganization > 0) {
      if ((await unitsSince(user.organizationId)) + units > perOrganization) {
        throw new RateLimitError("Your organization reached its daily AI limit. AI features resume as earlier requests age out of the 24-hour window.");
      }
    }
    if (concurrent > 0) {
      const running = await tx.aIRun.count({ where: { organizationId: user.organizationId, status: "RESERVED" } });
      if (running >= concurrent) {
        throw new RateLimitError("Several AI tasks are already running for your organization. Try again when they finish.");
      }
    }
    if (total > 0) {
      if ((await unitsSince(null)) + units > total) {
        throw new RateLimitError("The AI service reached its daily limit for this deployment. Try again later.");
      }
    }

    const run = await tx.aIRun.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        identityId: user.identityId,
        task: spec.task,
        units,
        provider: getAIProviderInfo().id,
      },
      select: { id: true },
    });
    // The ledger's timestamps come from the database clock, never from this server's.
    await tx.$executeRaw`UPDATE "AIRun" SET "createdAt" = ${DB_UTC_NOW}, "heartbeatAt" = ${DB_UTC_NOW} WHERE id = ${run.id}`;
    return run;
  });
}

/** Refresh the heartbeat of a run that is still RESERVED (database clock). False once the run was closed. */
async function beat(runId: string): Promise<boolean> {
  const updated = await prisma.$executeRaw`UPDATE "AIRun" SET "heartbeatAt" = ${DB_UTC_NOW} WHERE id = ${runId} AND status = 'RESERVED'`;
  return updated === 1;
}

export interface AIRunHeartbeat {
  /** True once a beat found the run closed: the job must not save anything. */
  readonly lost: boolean;
  stop(): void;
}

/**
 * Claim a reserved run for this process and keep it alive while the job works.
 * The first beat happens immediately (no gap at a hand-off, e.g. into `after()`).
 * Returns null when the run is already closed: do not call the model then.
 */
export async function startAIRunHeartbeat(runId: string, intervalMs = AI_RUN_HEARTBEAT_MS): Promise<AIRunHeartbeat | null> {
  if (!(await beat(runId))) return null;
  let lost = false;
  const timer = setInterval(() => {
    beat(runId)
      .then((alive) => {
        if (!alive) {
          lost = true;
          clearInterval(timer);
        }
      })
      .catch((error: unknown) => console.warn("[ai] heartbeat failed", runId, error));
  }, intervalMs);
  timer.unref?.();
  return {
    get lost() {
      return lost;
    },
    stop: () => clearInterval(timer),
  };
}

/**
 * Fencing for the transaction that saves a job's results: lock the run, require
 * that it is still RESERVED, and mark it SUCCEEDED in the same transaction. A run
 * closed meanwhile (presumed abandoned) rolls the whole transaction back.
 * Call it first in the transaction (lock order: AIRun, then case rows).
 */
export async function completeAIRunInTransaction(tx: TransactionClient, runId: string): Promise<void> {
  // Bounds every lock wait of this result transaction (the run here, case rows after it).
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${COMMIT_LOCK_TIMEOUT}'`);
  const rows = await tx.$queryRaw<Array<{ status: string }>>`SELECT status::text AS status FROM "AIRun" WHERE id = ${runId} FOR UPDATE`;
  if (rows[0]?.status !== "RESERVED") throw new AIRunLostError();
  await tx.$executeRaw`UPDATE "AIRun" SET status = 'SUCCEEDED', "finishedAt" = ${DB_UTC_NOW} WHERE id = ${runId}`;
}

/**
 * Close a reservation. FAILED still counts against the quota (the model may
 * have been called); RELEASED does not (nothing was dispatched). Best effort:
 * never turns a finished job into an error.
 */
export async function finishAIRun(runId: string, status: "SUCCEEDED" | "FAILED" | "RELEASED", error?: unknown) {
  const message = error === undefined ? null : (error instanceof Error ? error.message : String(error)).slice(0, 500);
  try {
    await prisma.$executeRaw`
      UPDATE "AIRun" SET status = ${status}::"AIRunStatus", "finishedAt" = ${DB_UTC_NOW}, error = ${message}
      WHERE id = ${runId} AND status = 'RESERVED'`;
  } catch (failure) {
    console.error("[ai] could not close AI run", runId, failure);
  }
}

/**
 * Reserve, run the model work and its persistence, then close the run. `work`
 * receives the run id and must call completeAIRunInTransaction in the
 * transaction that saves results; work that saves nothing is completed here.
 */
export async function withAIRun<T>(user: SessionUser, spec: AIRunSpec, work: (runId: string) => Promise<T>): Promise<T> {
  const run = await reserveAIRun(user, spec);
  const heartbeat = await startAIRunHeartbeat(run.id);
  try {
    if (!heartbeat) throw new AIRunLostError();
    const result = await work(run.id);
    await finishAIRun(run.id, "SUCCEEDED");
    return result;
  } catch (error) {
    await finishAIRun(run.id, "FAILED", error);
    throw error;
  } finally {
    heartbeat?.stop();
  }
}

/**
 * Two model calls of one job, run in parallel. Waits until both have finished
 * before reporting a failure, so a job is never closed (freeing its running
 * slot) while one of its calls is still in flight.
 */
export async function bothModelCalls<A, B>(first: Promise<A>, second: Promise<B>): Promise<[A, B]> {
  const [a, b] = await Promise.allSettled([first, second]);
  if (a.status === "rejected") throw a.reason;
  if (b.status === "rejected") throw b.reason;
  return [a.value, b.value];
}
