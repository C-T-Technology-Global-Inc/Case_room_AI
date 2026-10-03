import { prisma } from "@ccr/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCareTeam, resetDatabase, settle } from "@/test/integration/fixtures";
import { deriveDecisionStatus } from "../domain/decision-rules";
import { lockRow } from "@ccr/database";
import { isRetryableDatabaseError } from "../db-errors";
import { ConflictError, ForbiddenError, ValidationError } from "../errors";
import { createDecision, reviewDecision, reviseDecision } from "./decisions";

vi.mock("@/server/realtime/bus", () => ({ realtime: { touch: vi.fn(async () => {}), publish: vi.fn(async () => {}) } }));

type Team = Awaited<ReturnType<typeof createCareTeam>>;
let team: Team;

beforeEach(async () => {
  await resetDatabase();
  team = await createCareTeam();
});

const proposal = (team: Team) => ({
  title: "Synthetic neoadjuvant plan",
  description: "Proposed plan for the synthetic test patient.",
  rationale: "Synthetic rationale for concurrency testing.",
  reviewerIds: [team.reviewerA.id, team.reviewerB.id],
});

async function decisionState(id: string) {
  const decision = await prisma.decision.findUniqueOrThrow({ where: { id }, include: { approvals: { orderBy: { userId: "asc" } } } });
  const audit = await prisma.auditEvent.findMany({ where: { resourceId: id }, orderBy: { createdAt: "asc" } });
  const finalizedTimeline = await prisma.timelineEvent.count({ where: { caseRoomId: decision.caseRoomId, title: { endsWith: "approved" } } });
  return { decision, audit, finalizedTimeline };
}

describe("decision numbering (finding 10)", () => {
  it("gives concurrent proposals distinct sequential numbers", async () => {
    const outcome = await settle(...Array.from({ length: 6 }, () => () => createDecision(team.proposer, team.caseRoom.id, proposal(team))));
    expect(outcome.errors).toEqual([]);
    const numbers = (await prisma.decision.findMany({ where: { caseRoomId: team.caseRoom.id }, select: { number: true } })).map((d) => d.number);
    expect(numbers.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("linked discussion message (finding 2)", () => {
  it("rejects a message from another case, even of another organization", async () => {
    const other = await createCareTeam("Other");
    const foreign = await prisma.message.create({ data: { caseRoomId: other.caseRoom.id, authorId: other.proposer.id, content: "Synthetic message in another case" } });
    await expect(createDecision(team.proposer, team.caseRoom.id, { ...proposal(team), sourceMessageId: foreign.id })).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma.decision.count()).toBe(0);
  });

  it("accepts a message from the same case", async () => {
    const message = await prisma.message.create({ data: { caseRoomId: team.caseRoom.id, authorId: team.proposer.id, content: "Let us propose a plan" } });
    const decision = await createDecision(team.proposer, team.caseRoom.id, { ...proposal(team), sourceMessageId: message.id });
    expect(decision.sourceMessageId).toBe(message.id);
  });
});

describe("concurrent reviews and revisions (finding 1)", () => {
  it("finalizes exactly once when the last two reviewers approve at the same time", async () => {
    const decision = await createDecision(team.proposer, team.caseRoom.id, proposal(team));
    const outcome = await settle(
      () => reviewDecision(team.reviewerA, decision.id, { verdict: "APPROVED", expectedRevision: 1 }),
      () => reviewDecision(team.reviewerB, decision.id, { verdict: "APPROVED", expectedRevision: 1 }),
    );
    expect(outcome.errors).toEqual([]);
    const state = await decisionState(decision.id);
    expect(state.decision.approvals.map((a) => a.status)).toEqual(["APPROVED", "APPROVED"]);
    expect(state.decision.status).toBe("APPROVED");
    expect(state.decision.finalizedAt).not.toBeNull();
    expect(state.audit.filter((a) => a.action === "decision.finalized")).toHaveLength(1);
    expect(state.finalizedTimeline).toBe(1);
  });

  it("never records APPROVED next to a rejection when a reviewer changes their verdict concurrently", async () => {
    for (let round = 0; round < 5; round++) {
      const decision = await createDecision(team.proposer, team.caseRoom.id, proposal(team));
      await reviewDecision(team.reviewerA, decision.id, { verdict: "APPROVED", expectedRevision: 1 });
      const outcome = await settle(
        () => reviewDecision(team.reviewerA, decision.id, { verdict: "REJECTED", comment: "Changed my mind", expectedRevision: 1 }),
        () => reviewDecision(team.reviewerB, decision.id, { verdict: "APPROVED", expectedRevision: 1 }),
      );
      // The first one to lock the row finalizes the decision; the other is refused.
      expect(outcome.fulfilled).toBe(1);
      expect(outcome.errors[0]).toBeInstanceOf(ValidationError);
      const { decision: stored, audit } = await decisionState(decision.id);
      expect(stored.status).toBe(deriveDecisionStatus(stored.approvals.map((a) => a.status)));
      expect(["APPROVED", "REJECTED"]).toContain(stored.status);
      expect(audit.filter((a) => a.action === "decision.finalized")).toHaveLength(stored.status === "APPROVED" ? 1 : 0);
    }
  });

  it("lets either the final approval or a revision win, never a mix of both", async () => {
    for (let round = 0; round < 5; round++) {
      const decision = await createDecision(team.proposer, team.caseRoom.id, proposal(team));
      await reviewDecision(team.reviewerA, decision.id, { verdict: "APPROVED", expectedRevision: 1 });
      const outcome = await settle(
        () => reviewDecision(team.reviewerB, decision.id, { verdict: "APPROVED", expectedRevision: 1 }),
        () => reviseDecision(team.proposer, decision.id, { ...proposal(team), title: "Revised synthetic plan", expectedRevision: 1 }),
      );
      expect(outcome.fulfilled).toBe(1);
      const { decision: stored } = await decisionState(decision.id);
      if (stored.status === "APPROVED") {
        expect(stored.revision).toBe(1);
        expect(stored.title).toBe("Synthetic neoadjuvant plan");
        expect(stored.approvals.every((a) => a.status === "APPROVED")).toBe(true);
        expect(stored.finalizedAt).not.toBeNull();
      } else {
        expect(outcome.errors[0]).toBeInstanceOf(ConflictError);
        expect(stored.status).toBe("PROPOSED");
        expect(stored.revision).toBe(2);
        expect(stored.title).toBe("Revised synthetic plan");
        expect(stored.approvals.every((a) => a.status === "PENDING")).toBe(true);
        expect(stored.finalizedAt).toBeNull();
      }
    }
  });

  it("refuses a review of a revision the reviewer did not read", async () => {
    const decision = await createDecision(team.proposer, team.caseRoom.id, proposal(team));
    const { revision } = await reviseDecision(team.proposer, decision.id, { ...proposal(team), title: "Revised synthetic plan", expectedRevision: 1 });
    expect(revision).toBe(2);
    await expect(reviewDecision(team.reviewerA, decision.id, { verdict: "APPROVED", expectedRevision: 1 })).rejects.toBeInstanceOf(ConflictError);
    await expect(reviewDecision(team.reviewerA, decision.id, { verdict: "APPROVED", expectedRevision: 2 })).resolves.toEqual({ status: "UNDER_REVIEW" });
  });
});

describe("revision permissions (finding 6)", () => {
  it("refuses a revision by a proposer who no longer has a clinical role", async () => {
    const decision = await createDecision(team.proposer, team.caseRoom.id, proposal(team));
    await prisma.user.update({ where: { id: team.proposer.id }, data: { role: "NURSE" } });
    const demoted = { ...team.proposer, role: "NURSE" as const };
    await expect(reviseDecision(demoted, decision.id, { ...proposal(team), expectedRevision: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await prisma.decision.findUniqueOrThrow({ where: { id: decision.id } })).revision).toBe(1);
  });
});

describe("case status across different decisions (round 2, finding 2)", () => {
  const singleReviewer = (team: Team, title: string) => ({ ...proposal(team), title, reviewerIds: [team.reviewerA.id] });

  it("leaves decision-pending once the last two open decisions are finalized at the same time", async () => {
    for (let round = 0; round < 5; round++) {
      const first = await createDecision(team.proposer, team.caseRoom.id, singleReviewer(team, `Synthetic plan A${round}`));
      const second = await createDecision(team.proposer, team.caseRoom.id, singleReviewer(team, `Synthetic plan B${round}`));
      const outcome = await settle(
        () => reviewDecision(team.reviewerA, first.id, { verdict: "APPROVED", expectedRevision: 1 }),
        () => reviewDecision(team.reviewerA, second.id, { verdict: "APPROVED", expectedRevision: 1 }),
      );
      expect(outcome.errors).toEqual([]);
      expect((await prisma.caseRoom.findUniqueOrThrow({ where: { id: team.caseRoom.id } })).status).toBe("REVIEWING");
    }
  });

  it("stays decision-pending when a new proposal races the last final review", async () => {
    for (let round = 0; round < 5; round++) {
      const open = await createDecision(team.proposer, team.caseRoom.id, singleReviewer(team, `Synthetic plan ${round}`));
      const outcome = await settle(
        () => reviewDecision(team.reviewerA, open.id, { verdict: "APPROVED", expectedRevision: 1 }),
        () => createDecision(team.proposer, team.caseRoom.id, singleReviewer(team, `Competing plan ${round}`)),
      );
      expect(outcome.errors).toEqual([]);
      expect((await prisma.caseRoom.findUniqueOrThrow({ where: { id: team.caseRoom.id } })).status).toBe("DECISION_PENDING");
      // Close the competing proposal so the next round starts from a reviewed case.
      const competing = await prisma.decision.findFirstOrThrow({ where: { title: `Competing plan ${round}` } });
      await reviewDecision(team.reviewerA, competing.id, { verdict: "APPROVED", expectedRevision: 1 });
    }
  });
});

describe("lock waits (round 2)", () => {
  it("gives up on a held lock with a retryable error and changes nothing", async () => {
    const decision = await createDecision(team.proposer, team.caseRoom.id, proposal(team));
    let release: () => void = () => undefined;
    const holder = prisma.$transaction(
      async (tx) => {
        await lockRow(tx, "CaseRoom", team.caseRoom.id);
        await new Promise<void>((resolve) => {
          release = resolve;
          setTimeout(resolve, 6_000);
        });
      },
      { timeout: 10_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    const error = await reviewDecision(team.reviewerA, decision.id, { verdict: "APPROVED", expectedRevision: 1 }).catch((e: unknown) => e);
    release();
    await holder;
    expect(isRetryableDatabaseError(error)).toBe(true);
    const approvals = await prisma.approval.findMany({ where: { decisionId: decision.id } });
    expect(approvals.every((a) => a.status === "PENDING")).toBe(true);
  });
});
