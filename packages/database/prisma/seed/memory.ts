import { DemoCaseAIProvider, mergeMemoryFacts } from "@ccr/ai";
import type { BriefStatus, CaseMemory } from "@ccr/types";
import { emptyCaseMemory } from "@ccr/types";
import { loadCaseContext } from "../../src/case-context";
import { audit, json, type SeedContext } from "./helpers";

/**
 * Seed-time AI artefacts produced with the offline demo engine, so seeded
 * cases look exactly like cases processed by the running application.
 */

const provider = new DemoCaseAIProvider();

export async function buildSeedMemory(ctx: SeedContext, caseRoomId: string, patientSummary?: string) {
  const context = await loadCaseContext(ctx.prisma, caseRoomId);
  let memory: CaseMemory = emptyCaseMemory();
  for (const doc of context.documents) {
    const facts = await provider.extractMemoryFacts(context, doc);
    memory = mergeMemoryFacts(memory, facts.output, doc);
  }
  if (patientSummary) memory.patientSummary = patientSummary;
  await ctx.prisma.caseMemory.create({
    data: { caseRoomId, data: json(memory), version: Math.max(1, context.documents.length) },
  });
}

/** Timeline events for every document, as the upload pipeline would create them. */
export async function generateSeedTimeline(ctx: SeedContext, caseRoomId: string) {
  const context = await loadCaseContext(ctx.prisma, caseRoomId);
  const result = await provider.generateTimeline(context, context.documents);
  for (const event of result.output) {
    await ctx.prisma.timelineEvent.create({
      data: {
        caseRoomId,
        date: new Date(`${event.date}T00:00:00Z`),
        eventType: event.eventType,
        title: event.title,
        description: event.description,
        sourceDocumentId: event.sourceDocumentId,
        createdByAI: true,
      },
    });
  }
}

export async function generateSeedSummary(
  ctx: SeedContext,
  caseRoomId: string,
  options: { requestedById: string; createdAt: Date; status: BriefStatus; approvedById?: string; approvedAt?: Date },
) {
  const context = await loadCaseContext(ctx.prisma, caseRoomId, { now: options.createdAt });
  const [summary, missing] = await Promise.all([
    provider.generateCaseSummary(context),
    provider.identifyMissingInformation(context),
  ]);
  const brief = await ctx.prisma.caseBrief.create({
    data: {
      caseRoomId,
      type: "CASE_SUMMARY",
      status: options.status,
      title: "AI case summary",
      content: json({ kind: "case_summary", ...summary.output, missingInformation: missing.output }),
      generatedByAI: true,
      aiProvider: provider.info.id,
      aiModel: provider.info.model,
      requestedById: options.requestedById,
      approvedById: options.approvedById ?? null,
      approvedAt: options.approvedAt ?? null,
      createdAt: options.createdAt,
    },
  });
  await audit(ctx, {
    caseRoomId,
    userId: options.requestedById,
    actorType: "AI",
    action: "ai.summary_generated",
    resourceType: "CaseBrief",
    resourceId: brief.id,
    metadata: { documents: context.documents.length },
    createdAt: options.createdAt,
  });
  if (options.approvedById && options.approvedAt) {
    await audit(ctx, {
      caseRoomId,
      userId: options.approvedById,
      action: "brief.approved",
      resourceType: "CaseBrief",
      resourceId: brief.id,
      metadata: { title: brief.title, briefType: "CASE_SUMMARY" },
      createdAt: options.approvedAt,
    });
  }
  return brief;
}

export async function generateSeedTumorBoard(
  ctx: SeedContext,
  caseRoomId: string,
  options: { requestedById: string; createdAt: Date; approvedById: string; approvedAt: Date; title: string },
) {
  const context = await loadCaseContext(ctx.prisma, caseRoomId, { now: options.createdAt });
  const result = await provider.generateTumorBoardBrief(context);
  const brief = await ctx.prisma.caseBrief.create({
    data: {
      caseRoomId,
      type: "TUMOR_BOARD",
      status: "APPROVED",
      title: options.title,
      content: json(result.output),
      generatedByAI: true,
      aiProvider: provider.info.id,
      aiModel: provider.info.model,
      requestedById: options.requestedById,
      editedById: options.approvedById,
      editedAt: options.approvedAt,
      approvedById: options.approvedById,
      approvedAt: options.approvedAt,
      createdAt: options.createdAt,
    },
  });
  await audit(ctx, { caseRoomId, userId: options.requestedById, actorType: "AI", action: "tumor_board.generated", resourceType: "CaseBrief", resourceId: brief.id, metadata: { title: brief.title }, createdAt: options.createdAt });
  await audit(ctx, { caseRoomId, userId: options.approvedById, action: "brief.approved", resourceType: "CaseBrief", resourceId: brief.id, metadata: { title: brief.title, briefType: "TUMOR_BOARD" }, createdAt: options.approvedAt });
  return brief;
}
