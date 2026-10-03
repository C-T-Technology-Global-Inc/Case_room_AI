import { prisma } from "@ccr/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCareTeam, resetDatabase, settle } from "@/test/integration/fixtures";
import { RateLimitError } from "../errors";
import { bothModelCalls, finishAIRun, reserveAIRun, withAIRun } from "./ai-quota";

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
