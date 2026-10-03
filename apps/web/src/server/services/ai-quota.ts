import "server-only";
import { prisma } from "@ccr/database";
import type { SessionUser } from "../auth/session";
import { RateLimitError } from "../errors";
import { envLimit, namedLimiter, retryText } from "../rate-limit";
import { getAIProviderInfo } from "./ai";

const DAY_MS = 86_400_000;
/** A reservation older than this is treated as dead (crashed process) for the concurrency limit. */
const STALE_RUN_MS = 10 * 60_000;

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
  const now = Date.now();
  const since = new Date(now - DAY_MS);

  return prisma.$transaction(async (tx) => {
    // One reservation at a time across the deployment; the transaction holds nothing else.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('ccr-ai-runs'))`;
    const counted = { createdAt: { gte: since }, status: { not: "RELEASED" as const } };

    if (perOrganization > 0) {
      const used = await tx.aIRun.aggregate({ _sum: { units: true }, where: { organizationId: user.organizationId, ...counted } });
      if ((used._sum.units ?? 0) + units > perOrganization) {
        throw new RateLimitError("Your organization reached its daily AI limit. AI features resume as earlier requests age out of the 24-hour window.");
      }
    }
    if (concurrent > 0) {
      const running = await tx.aIRun.count({
        where: { organizationId: user.organizationId, status: "RESERVED", createdAt: { gte: new Date(now - STALE_RUN_MS) } },
      });
      if (running >= concurrent) {
        throw new RateLimitError("Several AI tasks are already running for your organization. Try again when they finish.");
      }
    }
    if (total > 0) {
      const used = await tx.aIRun.aggregate({ _sum: { units: true }, where: counted });
      if ((used._sum.units ?? 0) + units > total) {
        throw new RateLimitError("The AI service reached its daily limit for this deployment. Try again later.");
      }
    }

    return tx.aIRun.create({
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
  });
}

/**
 * Close a reservation. FAILED still counts against the quota (the model may
 * have been called); RELEASED does not (nothing was dispatched). Best effort:
 * never turns a finished job into an error.
 */
export async function finishAIRun(runId: string, status: "SUCCEEDED" | "FAILED" | "RELEASED", error?: unknown) {
  try {
    await prisma.aIRun.updateMany({
      where: { id: runId, status: "RESERVED" },
      data: {
        status,
        finishedAt: new Date(),
        error: error === undefined ? null : (error instanceof Error ? error.message : String(error)).slice(0, 500),
      },
    });
  } catch (failure) {
    console.error("[ai] could not close AI run", runId, failure);
  }
}

/** Reserve, run the model work and its persistence, then close the run as succeeded or failed. */
export async function withAIRun<T>(user: SessionUser, spec: AIRunSpec, work: () => Promise<T>): Promise<T> {
  const run = await reserveAIRun(user, spec);
  try {
    const result = await work();
    await finishAIRun(run.id, "SUCCEEDED");
    return result;
  } catch (error) {
    await finishAIRun(run.id, "FAILED", error);
    throw error;
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
