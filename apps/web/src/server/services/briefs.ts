import "server-only";
import { lockRow, prisma, type Prisma } from "@ccr/database";
import type { BriefType, CaseSummaryContent, SectionsContent } from "@ccr/types";
import { BRIEF_TYPE_LABELS, briefSectionSchema, parseBriefContent } from "@ccr/types";
import { z } from "zod";
import type { SessionUser } from "../auth/session";
import { assertCaseAccess } from "../authz/case-access";
import { assertCan } from "../authz/permissions";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { realtime } from "../realtime/bus";
import { buildCaseContext, getAIProvider } from "./ai";
import { bothModelCalls, completeAIRunInTransaction, withAIRun } from "./ai-quota";
import { recordAudit } from "./audit";
import { updateMemory } from "./memory";
import { postSystemMessage, touchCaseRoom } from "./system-messages";

const briefInclude = {
  requestedBy: { select: { id: true, name: true } },
  editedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true, specialty: true } },
} satisfies Prisma.CaseBriefInclude;

export async function listBriefs(user: SessionUser, caseRoomId: string, type: BriefType) {
  await assertCaseAccess(user, caseRoomId);
  const briefs = await prisma.caseBrief.findMany({
    where: { caseRoomId, type },
    include: briefInclude,
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return briefs.map((brief) => ({ ...brief, parsed: parseBriefContent(brief.content) }));
}

export async function getLatestSummary(user: SessionUser, caseRoomId: string) {
  const [latest] = await listBriefs(user, caseRoomId, "CASE_SUMMARY");
  if (!latest || latest.parsed?.kind !== "case_summary") return null;
  return { ...latest, summary: latest.parsed };
}

function requireEmptyGuard(documentCount: number) {
  if (documentCount === 0) throw new ValidationError("Upload at least one clinical document before generating AI content.");
}

export async function generateCaseSummary(user: SessionUser, caseRoomId: string) {
  assertCan(user, "brief.generate");
  await assertCaseAccess(user, caseRoomId);
  const ctx = await buildCaseContext(caseRoomId, user.id);
  requireEmptyGuard(ctx.documents.length);
  // Two model calls (summary + missing information), reserved before either runs.
  const brief = await withAIRun(user, { task: "case_summary", units: 2 }, async (runId) => {
    const provider = getAIProvider();
    const [summary, missing] = await bothModelCalls(provider.generateCaseSummary(ctx), provider.identifyMissingInformation(ctx));

    const content: CaseSummaryContent = { kind: "case_summary", ...summary.output, missingInformation: missing.output };
    // The model ran above; the brief, the memory update and the audit row commit together or not at all.
    return prisma.$transaction(async (tx) => {
      await completeAIRunInTransaction(tx, runId);
      const brief = await tx.caseBrief.create({
        data: {
          caseRoomId,
          type: "CASE_SUMMARY",
          status: "DRAFT",
          title: "AI case summary",
          content: content as Prisma.InputJsonValue,
          generatedByAI: true,
          aiProvider: summary.provider.id,
          aiModel: summary.model,
          requestedById: user.id,
        },
      });
      await updateMemory(tx, caseRoomId, (memory) => ({
        ...memory,
        patientSummary: `${content.headline} ${content.currentStatus}`.trim(),
        openQuestions: content.outstandingQuestions.length ? content.outstandingQuestions.slice(0, 10) : memory.openQuestions,
        updatedAt: new Date().toISOString(),
      }));
      await recordAudit(tx, {
        organizationId: user.organizationId,
        caseRoomId,
        userId: user.id,
        actorType: "AI",
        action: "ai.summary_generated",
        resourceType: "CaseBrief",
        resourceId: brief.id,
        metadata: { documents: ctx.documents.length, provider: summary.provider.id, model: summary.model, latencyMs: summary.latencyMs },
      });
      await touchCaseRoom(tx, caseRoomId);
      return brief;
    });
  });
  await realtime.touch(caseRoomId, ["briefs", "memory", "audit"], user.id);
  return brief;
}

async function generateSectionsBrief(user: SessionUser, caseRoomId: string, type: "TUMOR_BOARD" | "HANDOFF") {
  assertCan(user, type === "TUMOR_BOARD" ? "brief.generate" : "handoff.generate");
  await assertCaseAccess(user, caseRoomId);
  const ctx = await buildCaseContext(caseRoomId, user.id);
  requireEmptyGuard(ctx.documents.length);
  const brief = await withAIRun(user, { task: type === "TUMOR_BOARD" ? "tumor_board" : "handoff" }, async (runId) => {
    const provider = getAIProvider();
    const result = type === "TUMOR_BOARD" ? await provider.generateTumorBoardBrief(ctx) : await provider.generateHandoff(ctx);
    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

    return prisma.$transaction(async (tx) => {
      await completeAIRunInTransaction(tx, runId);
      const brief = await tx.caseBrief.create({
        data: {
          caseRoomId,
          type,
          status: "DRAFT",
          title: type === "TUMOR_BOARD" ? `Tumor board brief: ${date}` : `Handoff: ${date}`,
          content: result.output as Prisma.InputJsonValue,
          generatedByAI: true,
          aiProvider: result.provider.id,
          aiModel: result.model,
          requestedById: user.id,
        },
      });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        caseRoomId,
        userId: user.id,
        actorType: "AI",
        action: type === "TUMOR_BOARD" ? "tumor_board.generated" : "handoff.generated",
        resourceType: "CaseBrief",
        resourceId: brief.id,
        metadata: { title: brief.title, provider: result.provider.id, model: result.model, latencyMs: result.latencyMs },
      });
      await touchCaseRoom(tx, caseRoomId);
      return brief;
    });
  });
  await realtime.touch(caseRoomId, ["briefs", "audit"], user.id);
  return brief;
}

export const generateTumorBoardBrief = (user: SessionUser, caseRoomId: string) => generateSectionsBrief(user, caseRoomId, "TUMOR_BOARD");
export const generateHandoff = (user: SessionUser, caseRoomId: string) => generateSectionsBrief(user, caseRoomId, "HANDOFF");

export const updateSectionsSchema = z.object({
  sections: z.array(briefSectionSchema.pick({ key: true, body: true })).min(1),
  /** The version the clinician edited. */
  expectedVersion: z.number().int().positive(),
});

export const approveBriefSchema = z.object({
  /** The version the clinician read; sign-off always names exactly one version of the content. */
  expectedVersion: z.number().int().positive(),
});

const STALE_BRIEF = "This brief was edited after you opened it. Reload and review the current version.";

/** Resolve a brief and check case access; returns only immutable fields (type, case). */
async function accessibleBrief(user: SessionUser, briefId: string) {
  const brief = await prisma.caseBrief.findUnique({ where: { id: briefId }, select: { id: true, type: true, caseRoomId: true } });
  if (!brief) throw new NotFoundError("Brief not found");
  await assertCaseAccess(user, brief.caseRoomId);
  return brief;
}

/** Clinician edits of an AI draft. Every edit creates a new version; editing an approved brief returns it to draft. */
export async function updateBriefSections(user: SessionUser, briefId: string, raw: z.input<typeof updateSectionsSchema>) {
  const input = updateSectionsSchema.parse(raw);
  const { type, caseRoomId } = await accessibleBrief(user, briefId);
  assertCan(user, type === "HANDOFF" ? "handoff.generate" : "brief.generate");

  await prisma.$transaction(async (tx) => {
    // Lock order: CaseRoom → CaseBrief (same as approveBrief); the case row is touched below.
    await lockRow(tx, "CaseRoom", caseRoomId);
    await lockRow(tx, "CaseBrief", briefId);
    const brief = await tx.caseBrief.findUniqueOrThrow({ where: { id: briefId } });
    if (brief.version !== input.expectedVersion) throw new ConflictError(STALE_BRIEF);
    const content = parseBriefContent(brief.content);
    if (!content || content.kind !== "sections") throw new ValidationError("This brief cannot be edited section by section.");

    const bodies = new Map(input.sections.map((section) => [section.key, section.body.trim()]));
    const next: SectionsContent = {
      ...content,
      sections: content.sections.map((section) => {
        const body = bodies.get(section.key);
        if (body === undefined || body === section.body) return section;
        // Edited text is the clinician's; keep sources only if the text still references them.
        return { ...section, body, sources: /\[\d+\]/.test(body) ? section.sources : [] };
      }),
    };

    const updated = await tx.caseBrief.update({
      where: { id: briefId },
      data: {
        content: next as Prisma.InputJsonValue,
        version: { increment: 1 },
        editedById: user.id,
        editedAt: new Date(),
        status: "DRAFT",
        approvedById: null,
        approvedAt: null,
      },
    });
    await recordAudit(tx, {
      organizationId: user.organizationId,
      caseRoomId,
      userId: user.id,
      action: "brief.edited",
      resourceType: "CaseBrief",
      resourceId: briefId,
      metadata: { title: brief.title, briefType: brief.type, version: updated.version, wasApproved: brief.status === "APPROVED" },
    });
    // Moves the case version, so viewers who connect right after still notice the edit.
    await touchCaseRoom(tx, caseRoomId);
  });
  await realtime.touch(caseRoomId, ["briefs", "audit"], user.id);
}

/**
 * Human sign-off. The only path to APPROVED is an authenticated clinician calling this,
 * and the approval applies only to the exact version the clinician read.
 */
export async function approveBrief(user: SessionUser, briefId: string, raw: z.input<typeof approveBriefSchema>) {
  const input = approveBriefSchema.parse(raw);
  const { type, caseRoomId } = await accessibleBrief(user, briefId);
  assertCan(
    user,
    type === "HANDOFF" ? "handoff.approve" : "brief.approve",
    type === "HANDOFF" ? "Only clinicians can approve a handoff." : "Only physicians and specialists can approve this brief.",
  );

  const label = BRIEF_TYPE_LABELS[type];
  const changed = await prisma.$transaction(async (tx) => {
    // Lock order: CaseRoom → CaseBrief (approval also touches the case row).
    await lockRow(tx, "CaseRoom", caseRoomId);
    await lockRow(tx, "CaseBrief", briefId);
    const brief = await tx.caseBrief.findUniqueOrThrow({ where: { id: briefId } });
    if (brief.version !== input.expectedVersion) throw new ConflictError(STALE_BRIEF);
    if (brief.status === "APPROVED") return false;

    await tx.caseBrief.update({ where: { id: briefId }, data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() } });
    await recordAudit(tx, {
      organizationId: user.organizationId,
      caseRoomId,
      userId: user.id,
      action: type === "CASE_SUMMARY" ? "summary.reviewed" : "brief.approved",
      resourceType: "CaseBrief",
      resourceId: briefId,
      metadata: { title: brief.title, briefType: type, version: brief.version },
    });
    if (type !== "CASE_SUMMARY") {
      await postSystemMessage(tx, {
        caseRoomId,
        content:
          type === "TUMOR_BOARD"
            ? `${user.name} reviewed and shared the ${label.toLowerCase()} "${brief.title}".`
            : `${user.name} approved the ${label.toLowerCase()} "${brief.title}". It is now the final handoff.`,
        event: "brief.approved",
        refType: "brief",
        refId: briefId,
      });
    }
    await touchCaseRoom(tx, caseRoomId);
    return true;
  });
  if (changed) await realtime.touch(caseRoomId, ["briefs", "messages", "audit"], user.id);
}
