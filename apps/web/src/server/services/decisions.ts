import "server-only";
import { lockRow, prisma, type DbClient } from "@ccr/database";
import { TASK_PRIORITIES } from "@ccr/types";
import { z } from "zod";
import type { SessionUser } from "../auth/session";
import { assertCaseAccess } from "../authz/case-access";
import { assertCan, isClinicalReviewer } from "../authz/permissions";
import { deriveDecisionStatus, isFinal, reviewAction, type ReviewVerdict } from "../domain/decision-rules";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { realtime } from "../realtime/bus";
import { buildCaseContext, getAIProvider } from "./ai";
import { withAIRun } from "./ai-quota";
import { recordAudit } from "./audit";
import { postSystemMessage, touchCaseRoom } from "./system-messages";

export const decisionInputSchema = z.object({
  title: z.string().trim().min(5, "Give the decision a clear title").max(200),
  description: z.string().trim().min(10, "Describe the proposed decision").max(4000),
  rationale: z.string().trim().min(10, "Document the rationale").max(4000),
  sourceDocumentIds: z.array(z.string()).max(20).default([]),
  reviewerIds: z.array(z.string()).min(1, "Select at least one reviewer; decisions require human approval.").max(12),
  sourceMessageId: z.string().nullable().optional(),
});
export type DecisionInput = z.input<typeof decisionInputSchema>;

export async function listDecisions(user: SessionUser, caseRoomId: string) {
  await assertCaseAccess(user, caseRoomId);
  const decisions = await prisma.decision.findMany({
    where: { caseRoomId },
    include: {
      createdBy: { select: { id: true, name: true, specialty: true, role: true } },
      approvals: {
        include: { user: { select: { id: true, name: true, specialty: true, role: true } } },
        orderBy: { createdAt: "asc" },
      },
      sources: { include: { document: { select: { id: true, title: true, type: true, documentDate: true } } } },
      tasks: { include: { assignedTo: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
      sourceMessage: { select: { id: true, content: true, caseRoomId: true } },
    },
    orderBy: { number: "desc" },
  });
  // Never surface a linked message from another case, even if such a link was stored before validation existed.
  return decisions.map((d) => (d.sourceMessage && d.sourceMessage.caseRoomId !== caseRoomId ? { ...d, sourceMessage: null } : d));
}

async function validateReferences(
  db: DbClient,
  caseRoomId: string,
  organizationId: string,
  input: z.output<typeof decisionInputSchema>,
  proposerId: string,
) {
  const members = await db.caseRoomMember.findMany({
    where: { caseRoomId, userId: { in: input.reviewerIds } },
    include: { user: { select: { id: true, name: true, role: true, organizationId: true } } },
  });
  const reviewers = members.map((m) => m.user).filter((u) => u.organizationId === organizationId);
  if (reviewers.length !== new Set(input.reviewerIds).size) {
    throw new ValidationError("Reviewers must be members of this case's care team.");
  }
  if (reviewers.some((r) => r.id === proposerId)) {
    throw new ValidationError("The proposer cannot review their own decision. Choose other clinicians.");
  }
  if (reviewers.some((r) => !isClinicalReviewer(r.role))) {
    throw new ValidationError("Only physicians and specialists can review clinical decisions.");
  }
  const documents = await db.clinicalDocument.findMany({
    where: { caseRoomId, id: { in: input.sourceDocumentIds } },
    select: { id: true },
  });
  if (documents.length !== new Set(input.sourceDocumentIds).size) {
    throw new ValidationError("Some linked sources are not documents of this case.");
  }
  if (input.sourceMessageId) {
    const message = await db.message.findFirst({ where: { id: input.sourceMessageId, caseRoomId }, select: { id: true } });
    if (!message) throw new ValidationError("The linked message is not part of this case's discussion.");
  }
  return reviewers;
}

export async function createDecision(user: SessionUser, caseRoomId: string, raw: DecisionInput) {
  assertCan(user, "decision.create", "Only physicians and specialists can propose clinical decisions.");
  await assertCaseAccess(user, caseRoomId);
  const input = decisionInputSchema.parse(raw);

  const decision = await prisma.$transaction(async (tx) => {
    // Serializes numbering per case: a concurrent proposal waits here, then reads the new maximum.
    if (!(await lockRow(tx, "CaseRoom", caseRoomId))) throw new NotFoundError("Case not found");
    const reviewers = await validateReferences(tx, caseRoomId, user.organizationId, input, user.id);
    const last = await tx.decision.findFirst({ where: { caseRoomId }, orderBy: { number: "desc" }, select: { number: true } });
    const number = (last?.number ?? 0) + 1;
    const decision = await tx.decision.create({
      data: {
        caseRoomId,
        number,
        title: input.title,
        description: input.description,
        rationale: input.rationale,
        status: "PROPOSED",
        createdById: user.id,
        sourceMessageId: input.sourceMessageId ?? null,
        sources: { create: [...new Set(input.sourceDocumentIds)].map((documentId) => ({ documentId })) },
        approvals: { create: reviewers.map((reviewer) => ({ userId: reviewer.id, status: "PENDING" as const })) },
      },
    });
    await tx.timelineEvent.create({
      data: {
        caseRoomId,
        date: today(),
        eventType: "DECISION",
        title: `Decision #${number} proposed`,
        description: `${input.title}, proposed by ${user.name} for multidisciplinary review.`,
        createdById: user.id,
      },
    });
    await tx.caseRoom.updateMany({ where: { id: caseRoomId, status: { not: "CLOSED" } }, data: { status: "DECISION_PENDING" } });
    await postSystemMessage(tx, {
      caseRoomId,
      content: `${user.name} proposed Decision #${number}: ${input.title}. Reviewers: ${reviewers.map((r) => r.name).join(", ")}.`,
      event: "decision.proposed",
      refType: "decision",
      refId: decision.id,
    });
    await recordAudit(tx, {
      organizationId: user.organizationId,
      caseRoomId,
      userId: user.id,
      action: "decision.proposed",
      resourceType: "Decision",
      resourceId: decision.id,
      metadata: { number, revision: decision.revision, title: input.title, reviewers: reviewers.map((r) => r.name) },
    });
    await touchCaseRoom(tx, caseRoomId);
    return decision;
  });
  await realtime.touch(caseRoomId, ["decisions", "timeline", "messages", "case", "audit"], user.id);
  return decision;
}

export const reviewSchema = z.object({
  verdict: z.enum(["APPROVED", "REJECTED", "NEEDS_CHANGES"]),
  comment: z.string().trim().max(2000).optional(),
  /** The decision revision the reviewer read; a review of an older revision is refused. */
  expectedRevision: z.number().int().positive(),
});

const STALE_REVISION = "This decision was revised after you opened it. Reload and review the current version.";

/**
 * A human reviewer approves, rejects or requests changes.
 *
 * The case row, then the decision row, are locked for the whole
 * read-check-write: reviews and revisions of one decision apply one at a time,
 * and the case status (decision pending or not) is derived from the decisions
 * as they are after every earlier change, including other decisions of the case.
 */
export async function reviewDecision(user: SessionUser, decisionId: string, raw: z.input<typeof reviewSchema>) {
  assertCan(user, "decision.review", "Only physicians and specialists can review clinical decisions.");
  const input = reviewSchema.parse(raw);
  if (input.verdict !== "APPROVED" && !input.comment) {
    throw new ValidationError("Add a comment explaining the rejection or the requested changes.");
  }
  const caseRoomId = await accessibleDecisionCase(user, decisionId);
  const verdict = input.verdict as ReviewVerdict;
  const action = reviewAction(verdict);

  const nextStatus = await prisma.$transaction(async (tx) => {
    // Lock order: CaseRoom → Decision (same as createDecision and reviseDecision).
    await lockRow(tx, "CaseRoom", caseRoomId);
    await lockRow(tx, "Decision", decisionId);
    const decision = await tx.decision.findUnique({ where: { id: decisionId }, include: { approvals: true } });
    if (!decision) throw new NotFoundError("Decision not found");
    if (isFinal(decision.status)) throw new ValidationError("This decision has already been finalized.");
    if (decision.revision !== input.expectedRevision) throw new ConflictError(STALE_REVISION);
    const approval = decision.approvals.find((a) => a.userId === user.id);
    if (!approval) throw new ForbiddenError("You are not a requested reviewer for this decision.");

    const statuses = decision.approvals.map((a) => (a.id === approval.id ? verdict : a.status));
    const nextStatus = deriveDecisionStatus(statuses);
    const meta = { number: decision.number, revision: decision.revision, title: decision.title };

    await tx.approval.update({
      where: { id: approval.id },
      data: { status: verdict, comment: input.comment || null, respondedAt: new Date() },
    });
    await tx.decision.update({
      where: { id: decision.id },
      data: { status: nextStatus, finalizedAt: isFinal(nextStatus) ? new Date() : null },
    });
    await recordAudit(tx, {
      organizationId: user.organizationId,
      caseRoomId,
      userId: user.id,
      action: action.audit,
      resourceType: "Decision",
      resourceId: decision.id,
      metadata: { ...meta, comment: input.comment ?? null },
    });
    await postSystemMessage(tx, {
      caseRoomId,
      content: `${user.name} ${action.verb} Decision #${decision.number}${input.comment ? `: "${input.comment}"` : "."}`,
      event: action.audit,
      refType: "decision",
      refId: decision.id,
    });
    // The status was not final when the row was locked, so this branch runs once per decision.
    if (nextStatus === "APPROVED") {
      await postSystemMessage(tx, {
        caseRoomId,
        content: `Decision #${decision.number} was approved by all ${statuses.length} reviewers and is recorded as the final human-approved decision.`,
        event: "decision.finalized",
        refType: "decision",
        refId: decision.id,
      });
      await tx.timelineEvent.create({
        data: {
          caseRoomId,
          date: today(),
          eventType: "DECISION",
          title: `Decision #${decision.number} approved`,
          description: `${decision.title}. Final human-approved decision after review by the care team.`,
          createdById: user.id,
        },
      });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        caseRoomId,
        userId: user.id,
        actorType: "SYSTEM",
        action: "decision.finalized",
        resourceType: "Decision",
        resourceId: decision.id,
        metadata: { ...meta, reviewers: statuses.length },
      });
    }
    if (isFinal(nextStatus)) {
      const pending = await tx.decision.count({
        where: { caseRoomId, status: { in: ["PROPOSED", "UNDER_REVIEW"] }, id: { not: decision.id } },
      });
      if (pending === 0) {
        await tx.caseRoom.updateMany({ where: { id: caseRoomId, status: "DECISION_PENDING" }, data: { status: "REVIEWING" } });
      }
    }
    await touchCaseRoom(tx, caseRoomId);
    return nextStatus;
  });
  await realtime.touch(caseRoomId, ["decisions", "timeline", "messages", "case", "audit"], user.id);
  return { status: nextStatus };
}

export const reviseSchema = decisionInputSchema.omit({ reviewerIds: true, sourceMessageId: true }).extend({
  reviewerIds: z.array(z.string()).max(12).optional(),
  /** The revision the proposer edited; a concurrent review or revision makes it stale. */
  expectedRevision: z.number().int().positive(),
});
export type ReviseInput = z.input<typeof reviseSchema>;

/** The proposer revises a decision after feedback; the revision number increases and all reviews reset to pending. */
export async function reviseDecision(user: SessionUser, decisionId: string, raw: ReviseInput) {
  assertCan(user, "decision.create", "Only physicians and specialists can revise clinical decisions.");
  const revise = reviseSchema.parse(raw);
  const caseRoomId = await accessibleDecisionCase(user, decisionId);

  const revision = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "CaseRoom", caseRoomId);
    await lockRow(tx, "Decision", decisionId);
    const decision = await tx.decision.findUnique({ where: { id: decisionId }, include: { approvals: true } });
    if (!decision) throw new NotFoundError("Decision not found");
    if (decision.createdById !== user.id) throw new ForbiddenError("Only the proposer can revise this decision.");
    if (isFinal(decision.status)) throw new ValidationError("Finalized decisions cannot be revised. Propose a new decision instead.");
    if (decision.revision !== revise.expectedRevision) {
      throw new ConflictError("This decision changed after you opened it (new reviews or another revision). Reload before revising.");
    }
    const input = decisionInputSchema.parse({ ...revise, reviewerIds: revise.reviewerIds ?? decision.approvals.map((a) => a.userId) });
    const reviewers = await validateReferences(tx, caseRoomId, user.organizationId, input, user.id);

    const updated = await tx.decision.update({
      where: { id: decisionId },
      data: {
        title: input.title,
        description: input.description,
        rationale: input.rationale,
        status: "PROPOSED",
        finalizedAt: null,
        revision: { increment: 1 },
      },
    });
    await tx.decisionSource.deleteMany({ where: { decisionId } });
    if (input.sourceDocumentIds.length) {
      await tx.decisionSource.createMany({ data: [...new Set(input.sourceDocumentIds)].map((documentId) => ({ decisionId, documentId })) });
    }
    await tx.approval.deleteMany({ where: { decisionId } });
    await tx.approval.createMany({ data: reviewers.map((r) => ({ decisionId, userId: r.id, status: "PENDING" as const })) });
    await postSystemMessage(tx, {
      caseRoomId,
      content: `${user.name} revised Decision #${decision.number} (revision ${updated.revision}). All reviews were reset and are pending again.`,
      event: "decision.revised",
      refType: "decision",
      refId: decisionId,
    });
    await recordAudit(tx, {
      organizationId: user.organizationId,
      caseRoomId,
      userId: user.id,
      action: "decision.revised",
      resourceType: "Decision",
      resourceId: decisionId,
      metadata: { number: decision.number, revision: updated.revision, title: input.title },
    });
    await touchCaseRoom(tx, caseRoomId);
    return updated.revision;
  });
  await realtime.touch(caseRoomId, ["decisions", "messages", "audit"], user.id);
  return { revision };
}

/** Resolve the case of a decision, failing with 404 unless the user can access that case. */
async function accessibleDecisionCase(user: SessionUser, decisionId: string): Promise<string> {
  const decision = await prisma.decision.findUnique({ where: { id: decisionId }, select: { caseRoomId: true } });
  if (!decision) throw new NotFoundError("Decision not found");
  await assertCaseAccess(user, decision.caseRoomId);
  return decision.caseRoomId;
}

function today(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
}

/** AI proposes follow-up tasks for an approved decision. Nothing is created until a human confirms. */
export async function suggestFollowUpTasks(user: SessionUser, decisionId: string) {
  assertCan(user, "task.manage");
  const decision = await prisma.decision.findUnique({ where: { id: decisionId } });
  if (!decision) throw new NotFoundError("Decision not found");
  await assertCaseAccess(user, decision.caseRoomId);
  if (decision.status !== "APPROVED") throw new ValidationError("Follow-up tasks are suggested once the decision is approved.");

  const ctx = await buildCaseContext(decision.caseRoomId, user.id);
  const result = await withAIRun(user, { task: "follow_up_tasks" }, () => getAIProvider().suggestFollowUpTasks(ctx, decisionId));
  await recordAudit(prisma, {
    organizationId: user.organizationId,
    caseRoomId: decision.caseRoomId,
    userId: user.id,
    actorType: "AI",
    action: "ai.tasks_suggested",
    resourceType: "Decision",
    resourceId: decisionId,
    metadata: { number: decision.number, suggestions: result.output.length, provider: result.provider.id },
  });
  return { suggestions: result.output, provider: result.provider };
}

export const confirmTasksSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().trim().min(3).max(200),
        description: z.string().trim().max(2000).optional(),
        priority: z.enum(TASK_PRIORITIES),
        assigneeId: z.string().nullable(),
        dueDate: z.iso.date().nullable(),
      }),
    )
    .min(1, "Select at least one task")
    .max(10),
});

/** Create the AI-suggested tasks the human selected (flagged createdByAI). */
export async function createFollowUpTasks(user: SessionUser, decisionId: string, raw: z.input<typeof confirmTasksSchema>) {
  assertCan(user, "task.manage");
  const input = confirmTasksSchema.parse(raw);
  const decision = await prisma.decision.findUnique({ where: { id: decisionId } });
  if (!decision) throw new NotFoundError("Decision not found");
  await assertCaseAccess(user, decision.caseRoomId);
  const memberIds = new Set(
    (await prisma.caseRoomMember.findMany({ where: { caseRoomId: decision.caseRoomId }, select: { userId: true } })).map((m) => m.userId),
  );

  await prisma.$transaction(async (tx) => {
    for (const task of input.tasks) {
      const created = await tx.task.create({
        data: {
          caseRoomId: decision.caseRoomId,
          title: task.title,
          description: task.description ?? null,
          priority: task.priority,
          assignedToId: task.assigneeId && memberIds.has(task.assigneeId) ? task.assigneeId : null,
          dueDate: task.dueDate ? new Date(`${task.dueDate}T00:00:00Z`) : null,
          createdById: user.id,
          createdByAI: true,
          decisionId,
        },
      });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        caseRoomId: decision.caseRoomId,
        userId: user.id,
        action: "task.created",
        resourceType: "Task",
        resourceId: created.id,
        metadata: { title: created.title, aiSuggested: true, decision: decision.number },
      });
    }
    await postSystemMessage(tx, {
      caseRoomId: decision.caseRoomId,
      content: `${user.name} created ${input.tasks.length} follow-up task${input.tasks.length === 1 ? "" : "s"} for Decision #${decision.number} (AI-suggested, human-confirmed).`,
      event: "task.created",
      refType: "decision",
      refId: decisionId,
    });
    await touchCaseRoom(tx, decision.caseRoomId);
  });
  await realtime.touch(decision.caseRoomId, ["tasks", "decisions", "messages", "audit"], user.id);
}
