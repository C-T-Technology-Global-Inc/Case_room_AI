import { prisma } from "@ccr/database";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCareTeam, resetDatabase } from "@/test/integration/fixtures";
import { isRetryableDatabaseError } from "../db-errors";
import { AIRunLostError, reserveAIRun } from "./ai-quota";
import { generateCaseSummary, generateHandoff } from "./briefs";
import { createDocument, processDocument } from "./documents";
import { answerInDiscussion, postMessage } from "./messages";

vi.mock("@/server/realtime/bus", () => ({ realtime: { touch: vi.fn(async () => {}), publish: vi.fn(async () => {}) } }));

/** A provider whose calls the test controls; everything else is the real offline engine. */
const control = vi.hoisted(() => ({ hold: null as Promise<void> | null, calls: [] as string[] }));
vi.mock("./ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ai")>();
  const real = actual.getAIProvider();
  const held = <T>(name: string, run: () => Promise<T>) => async () => {
    control.calls.push(name);
    if (control.hold) await control.hold;
    return run();
  };
  const provider = new Proxy(real, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => held(String(property), () => (value as (...a: unknown[]) => Promise<unknown>).apply(target, args))();
    },
  });
  return { ...actual, getAIProvider: () => provider };
});

type Team = Awaited<ReturnType<typeof createCareTeam>>;
let team: Team;
let release: () => void = () => undefined;

beforeEach(async () => {
  await resetDatabase();
  team = await createCareTeam();
  vi.stubEnv("AI_REQUESTS_PER_USER_PER_MINUTE", "0");
  vi.stubEnv("AI_CONCURRENT_RUNS_PER_ORG", "1");
  control.calls = [];
  control.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  release();
  control.hold = null;
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const document = () =>
  createDocument(team.proposer, team.caseRoom.id, {
    title: "Synthetic labs",
    type: "LAB_RESULT",
    documentDate: "2026-09-03",
    text: "CA 19-9: 980 U/mL (reference < 37). Bilirubin 1.1 mg/dL. Synthetic laboratory report.",
  });

/** Make a run look abandoned to the database clock (its heartbeat silent for 3 minutes). */
async function silence(runId: string) {
  await prisma.$executeRaw`UPDATE "AIRun" SET "heartbeatAt" = (now() AT TIME ZONE 'UTC') - interval '3 minutes' WHERE id = ${runId}`;
}

async function waitFor(condition: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("condition not reached");
}

describe("AI run ownership (round 4, finding 1)", () => {
  it("does not sweep a live run because an app server's clock runs ahead", async () => {
    await document();
    const summary = generateCaseSummary(team.proposer, team.caseRoom.id).catch((error: unknown) => error);
    await waitFor(async () => control.calls.length > 0);

    // Another app server whose clock is 130 s ahead tries to reserve: the live run keeps its slot.
    const realNow = Date.now;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 130_000);
    await expect(reserveAIRun(team.reviewerA, { task: "case_question" })).rejects.toThrow(/already running/);
    vi.mocked(Date.now).mockRestore();

    release();
    expect(await summary).toMatchObject({ id: expect.any(String) });
    expect((await prisma.aIRun.findFirstOrThrow({ where: { task: "case_summary" } })).status).toBe("SUCCEEDED");
  });

  it("a job whose run was closed while it worked saves nothing", async () => {
    await document();
    const summary = generateCaseSummary(team.proposer, team.caseRoom.id).catch((error: unknown) => error);
    await waitFor(async () => control.calls.length > 0);
    const run = await prisma.aIRun.findFirstOrThrow({ where: { task: "case_summary" } });

    await silence(run.id);
    await reserveAIRun(team.reviewerA, { task: "case_question" }); // sweeps the silent run
    expect((await prisma.aIRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("FAILED");

    release();
    expect(await summary).toBeInstanceOf(AIRunLostError);
    expect(await prisma.caseBrief.count({ where: { caseRoomId: team.caseRoom.id, type: "CASE_SUMMARY" } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: "ai.summary_generated" } })).toBe(0);
    expect((await prisma.aIRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("FAILED");
  });

  it("an @AI answer whose reservation was closed before the hand-off never calls the model", async () => {
    release();
    const posted = await postMessage(team.proposer, team.caseRoom.id, "@AI what does the record say about CA 19-9?");
    await silence(posted.aiRunId!);
    await reserveAIRun(team.reviewerA, { task: "case_question" });

    await answerInDiscussion({
      caseRoomId: team.caseRoom.id,
      organizationId: team.organization.id,
      questionMessageId: posted.message.id,
      question: posted.aiQuestion!,
      requester: { id: team.proposer.id, name: team.proposer.name },
      aiRunId: posted.aiRunId!,
    });
    expect(control.calls).toEqual([]);
    expect(await prisma.auditEvent.count({ where: { action: "ai.answer_generated" } })).toBe(0);
    const reply = await prisma.message.findFirstOrThrow({ where: { caseRoomId: team.caseRoom.id, type: "AI" }, orderBy: { createdAt: "desc" } });
    expect(reply.content).toMatch(/results were not saved/);
  });

  it("document processing whose reservation was closed before the hand-off marks the document failed", async () => {
    release();
    const doc = await document();
    const run = await reserveAIRun(team.proposer, { task: "document", units: 2 });
    await silence(run.id);
    vi.stubEnv("AI_CONCURRENT_RUNS_PER_ORG", "0");
    await reserveAIRun(team.reviewerA, { task: "case_question" });

    await processDocument(doc.id, team.proposer.id, run.id);
    expect(control.calls).toEqual([]);
    const stored = await prisma.clinicalDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(stored.processingStatus).toBe("FAILED");
    expect(stored.processingError).toMatch(/AI processing was interrupted.*The document itself is stored/);
    expect(await prisma.auditEvent.count({ where: { action: "ai.document_failed", resourceId: doc.id } })).toBe(1);
    expect(await prisma.timelineEvent.count({ where: { sourceDocumentId: doc.id } })).toBe(0);
  });

  it("handing the same run to document processing twice does not undo a completed result", async () => {
    release();
    const doc = await document();
    const run = await reserveAIRun(team.proposer, { task: "document", units: 2 });
    await processDocument(doc.id, team.proposer.id, run.id);
    expect((await prisma.clinicalDocument.findUniqueOrThrow({ where: { id: doc.id } })).processingStatus).toBe("COMPLETED");
    const calls = control.calls.length;

    await processDocument(doc.id, team.proposer.id, run.id);
    expect((await prisma.clinicalDocument.findUniqueOrThrow({ where: { id: doc.id } })).processingStatus).toBe("COMPLETED");
    expect(control.calls.length).toBe(calls);
  });
});

describe("lock waits around AI runs (round 5, finding 1)", () => {
  const lockWaiters = async () => {
    const rows = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    return rows[0]?.n ?? 0;
  };

  it("a result transaction stuck behind a case row neither blocks other organizations nor waits past its budget", async () => {
    await document();
    const other = await createCareTeam("Other");
    const handoff = generateHandoff(team.proposer, team.caseRoom.id).catch((error: unknown) => error);
    await waitFor(async () => control.calls.length > 0);
    const run = await prisma.aIRun.findFirstOrThrow({ where: { task: "handoff" } });
    await silence(run.id); // the sweep will consider it

    // Another transaction holds the case row while the handoff tries to save its result.
    const blocker = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query('SELECT id FROM "CaseRoom" WHERE id = $1 FOR UPDATE', [team.caseRoom.id]);
      const releasedAt = Date.now();
      release();
      await waitFor(async () => (await lockWaiters()) > 0);

      // The sweep skips the run locked by the committing transaction instead of waiting for it.
      const started = Date.now();
      await reserveAIRun(other.proposer, { task: "case_question" });
      expect(Date.now() - started).toBeLessThan(1_500);

      // The result transaction gives up on its own (lock_timeout), rolled back and retryable.
      const error = await handoff;
      expect(isRetryableDatabaseError(error)).toBe(true);
      expect(Date.now() - releasedAt).toBeLessThan(4_500); // before the 5 s transaction budget
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      await blocker.end();
    }
    expect(await prisma.caseBrief.count({ where: { caseRoomId: team.caseRoom.id, type: "HANDOFF" } })).toBe(0);
    expect((await prisma.aIRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("FAILED");
  });
});
