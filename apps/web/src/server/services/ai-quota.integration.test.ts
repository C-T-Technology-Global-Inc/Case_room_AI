import { prisma } from "@ccr/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCareTeam, resetDatabase, settle } from "@/test/integration/fixtures";
import { RateLimitError } from "../errors";
import { AI_RUN_STALE_MS, bothModelCalls, finishAIRun, reserveAIRun, startAIRunHeartbeat, withAIRun } from "./ai-quota";

vi.mock("@/server/realtime/bus", () => ({ realtime: { touch: vi.fn(async () => {}), publish: vi.fn(async () => {}) } }));

type Team = Awaited<ReturnType<typeof createCareTeam>>;
let team: Team;

beforeEach(async () => {
  await resetDatabase();
  team = await createCareTeam();
  // Burst limit per person is in-memory and tested separately.
  vi.stubEnv("AI_REQUESTS_PER_USER_PER_MINUTE", "0");
  vi.stubEnv("AI_CONCURRENT_RUNS_PER_ORG", "0");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AI budget reservations (round 2, finding 1)", () => {
  it("never lets concurrent requests overshoot the daily cap", async () => {
    vi.stubEnv("AI_DAILY_REQUESTS_PER_ORG", "3");
    const outcome = await settle(...Array.from({ length: 12 }, () => () => reserveAIRun(team.proposer, { task: "case_question" })));
    expect(outcome.fulfilled).toBe(3);
    expect(outcome.errors.every((e) => e instanceof RateLimitError)).toBe(true);
    expect(await prisma.aIRun.count({ where: { organizationId: team.organization.id } })).toBe(3);
  });

  it("counts failed paid attempts and multi-call jobs, but not released reservations", async () => {
    vi.stubEnv("AI_DAILY_REQUESTS_PER_ORG", "4");
    await expect(
      withAIRun(team.proposer, { task: "case_summary", units: 2 }, async () => {
        throw new Error("schema mismatch after a paid completion");
      }),
    ).rejects.toThrow(/schema mismatch/);
    const released = await reserveAIRun(team.proposer, { task: "document", units: 2 });
    await finishAIRun(released.id, "RELEASED");
    await reserveAIRun(team.proposer, { task: "document", units: 2 });
    await expect(reserveAIRun(team.proposer, { task: "case_question" })).rejects.toBeInstanceOf(RateLimitError);

    const runs = await prisma.aIRun.findMany({ orderBy: { createdAt: "asc" } });
    expect(runs.map((r) => r.status)).toEqual(["FAILED", "RELEASED", "RESERVED"]);
    expect(runs[0]!.error).toMatch(/schema mismatch/);
  });

  it("limits jobs running at once per organization", async () => {
    vi.stubEnv("AI_CONCURRENT_RUNS_PER_ORG", "2");
    const first = await reserveAIRun(team.proposer, { task: "case_question" });
    await reserveAIRun(team.reviewerA, { task: "case_question" });
    await expect(reserveAIRun(team.reviewerB, { task: "case_question" })).rejects.toThrow(/already running/);
    await finishAIRun(first.id, "SUCCEEDED");
    await expect(reserveAIRun(team.reviewerB, { task: "case_question" })).resolves.toBeTruthy();
  });

  it("applies a deployment-wide cap across organizations", async () => {
    vi.stubEnv("AI_DAILY_REQUESTS_TOTAL", "2");
    const other = await createCareTeam("Other");
    await reserveAIRun(team.proposer, { task: "case_question" });
    await reserveAIRun(other.proposer, { task: "case_question" });
    await expect(reserveAIRun(other.reviewerA, { task: "case_question" })).rejects.toThrow(/deployment/);
  });
});

describe("jobs with two model calls (round 3 finding 2)", () => {
  it("keeps the run reserved until both calls have finished, even after one fails", async () => {
    vi.stubEnv("AI_CONCURRENT_RUNS_PER_ORG", "1");
    let finishSlowCall: () => void = () => undefined;
    const slowCall = new Promise<string>((resolve) => {
      finishSlowCall = () => resolve("missing information");
    });
    const job = withAIRun(team.proposer, { task: "case_summary", units: 2 }, () =>
      bothModelCalls(Promise.reject(new Error("summary call failed")), slowCall),
    ).catch((error: unknown) => error);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await prisma.aIRun.findFirstOrThrow()).status).toBe("RESERVED");
    await expect(reserveAIRun(team.reviewerA, { task: "case_question" })).rejects.toThrow(/already running/);

    finishSlowCall();
    expect(await job).toBeInstanceOf(Error);
    const run = await prisma.aIRun.findFirstOrThrow();
    expect(run).toMatchObject({ status: "FAILED", units: 2 });
    await expect(reserveAIRun(team.reviewerA, { task: "case_question" })).resolves.toBeTruthy();
  });
});

describe("running jobs are tracked by heartbeat, not age (round 3)", () => {
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

  it("keeps the slot of a slow job that is still alive, however old it is", async () => {
    vi.stubEnv("AI_CONCURRENT_RUNS_PER_ORG", "1");
    const run = await reserveAIRun(team.proposer, { task: "case_summary", units: 2 });
    // Started 25 minutes ago, still heartbeating.
    await prisma.aIRun.update({ where: { id: run.id }, data: { createdAt: minutesAgo(25), heartbeatAt: new Date() } });
    await expect(reserveAIRun(team.reviewerA, { task: "case_question" })).rejects.toThrow(/already running/);
    expect((await prisma.aIRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("RESERVED");
  });

  it("closes the run of a process that stopped, and still counts its units", async () => {
    vi.stubEnv("AI_CONCURRENT_RUNS_PER_ORG", "1");
    vi.stubEnv("AI_DAILY_REQUESTS_PER_ORG", "3");
    const dead = await reserveAIRun(team.proposer, { task: "document", units: 2 });
    await prisma.aIRun.update({ where: { id: dead.id }, data: { heartbeatAt: new Date(Date.now() - AI_RUN_STALE_MS - 1_000) } });

    await reserveAIRun(team.reviewerA, { task: "case_question" }); // slot freed: the dead run no longer holds it
    const closed = await prisma.aIRun.findUniqueOrThrow({ where: { id: dead.id } });
    expect(closed.status).toBe("FAILED");
    expect(closed.error).toMatch(/no heartbeat/);
    // 2 (abandoned) + 1 used: the daily budget of 3 is exhausted.
    await finishAIRun((await prisma.aIRun.findFirstOrThrow({ where: { status: "RESERVED" } })).id, "SUCCEEDED");
    await expect(reserveAIRun(team.reviewerB, { task: "case_question" })).rejects.toThrow(/daily AI limit/);
  });

  it("refreshes the heartbeat while the job runs and stops when told to", async () => {
    const run = await reserveAIRun(team.proposer, { task: "case_question" });
    await prisma.aIRun.update({ where: { id: run.id }, data: { heartbeatAt: minutesAgo(1) } });
    const heartbeat = await startAIRunHeartbeat(run.id, 50);
    await new Promise((resolve) => setTimeout(resolve, 200));
    heartbeat!.stop();
    const beat = (await prisma.aIRun.findUniqueOrThrow({ where: { id: run.id } })).heartbeatAt;
    expect(Date.now() - beat.getTime()).toBeLessThan(5_000);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await prisma.aIRun.findUniqueOrThrow({ where: { id: run.id } })).heartbeatAt).toEqual(beat);
  });
});

describe("rolling 24-hour window on the database clock (round 5, finding 2)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const ageRun = (runId: string, age: string) =>
    prisma.$executeRawUnsafe(`UPDATE "AIRun" SET "createdAt" = (now() AT TIME ZONE 'UTC') - interval '${age}' WHERE id = $1`, runId);

  it("app servers with fast or slow clocks count the same 24 hours", async () => {
    vi.stubEnv("AI_DAILY_REQUESTS_PER_ORG", "1");
    const first = await reserveAIRun(team.proposer, { task: "case_question" });
    await finishAIRun(first.id, "SUCCEEDED");

    // 23 h 59 min old on the database clock: still counted by a server whose clock is 130 s fast.
    await ageRun(first.id, "23 hours 59 minutes");
    vi.useFakeTimers({ now: Date.now() + 130_000, toFake: ["Date"] });
    await expect(reserveAIRun(team.reviewerA, { task: "case_question" })).rejects.toThrow(/daily AI limit/);
    vi.useRealTimers();

    // 24 h 1 min old: no longer counted, also by a server whose clock is 130 s slow.
    await ageRun(first.id, "24 hours 1 minute");
    vi.useFakeTimers({ now: Date.now() - 130_000, toFake: ["Date"] });
    const fresh = await reserveAIRun(team.reviewerA, { task: "case_question" });
    vi.useRealTimers();

    // The new run's timestamps come from the database clock, not from the skewed server.
    const drift = await prisma.$queryRaw<Array<{ created: number; finished: number | null }>>`
      SELECT abs(extract(epoch FROM ("createdAt" - (now() AT TIME ZONE 'UTC'))))::float AS created, NULL::float AS finished
      FROM "AIRun" WHERE id = ${fresh.id}`;
    expect(drift[0]!.created).toBeLessThan(5);
  });
});
