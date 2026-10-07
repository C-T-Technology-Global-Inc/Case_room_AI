import "server-only";
import { prisma } from "@ccr/database";
import { TIMELINE_EVENT_TYPES } from "@ccr/types";
import { z } from "zod";
import type { SessionUser } from "../auth/session";
import { assertCaseAccess } from "../authz/case-access";
import { assertCan } from "../authz/permissions";
import { ValidationError } from "../errors";
import { realtime } from "../realtime/bus";
import { buildCaseContext, getAIProvider } from "./ai";
import { completeAIRunInTransaction, withAIRun } from "./ai-quota";
import { recordAudit } from "./audit";
import { touchCaseRoom } from "./system-messages";

export async function listTimeline(user: SessionUser, caseRoomId: string) {
  await assertCaseAccess(user, caseRoomId);
  return prisma.timelineEvent.findMany({
    where: { caseRoomId },
    include: {
      sourceDocument: { select: { id: true, title: true, type: true } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
}

export const timelineEventSchema = z.object({
  date: z.iso.date("Date is required"),
  eventType: z.enum(TIMELINE_EVENT_TYPES),
  title: z.string().trim().min(3, "Title is required").max(160),
  description: z.string().trim().min(3, "Description is required").max(2000),
  sourceDocumentId: z.string().nullable().optional(),
});

export async function addTimelineEvent(user: SessionUser, caseRoomId: string, raw: z.input<typeof timelineEventSchema>) {
  assertCan(user, "timeline.edit");
  await assertCaseAccess(user, caseRoomId);
  const input = timelineEventSchema.parse(raw);
  if (input.sourceDocumentId) {
    const doc = await prisma.clinicalDocument.findFirst({ where: { id: input.sourceDocumentId, caseRoomId } });
    if (!doc) throw new ValidationError("The linked document does not belong to this case.");
  }
  const event = await prisma.$transaction(async (tx) => {
    const event = await tx.timelineEvent.create({
      data: {
        caseRoomId,
        date: new Date(`${input.date}T00:00:00Z`),
        eventType: input.eventType,
        title: input.title,
        description: input.description,
        sourceDocumentId: input.sourceDocumentId ?? null,
        createdByAI: false,
        createdById: user.id,
      },
    });
    await recordAudit(tx, {
      organizationId: user.organizationId,
      caseRoomId,
      userId: user.id,
      action: "timeline.event_added",
      resourceType: "TimelineEvent",
      resourceId: event.id,
      metadata: { title: event.title, date: input.date },
    });
    await touchCaseRoom(tx, caseRoomId);
    return event;
  });
  await realtime.touch(caseRoomId, ["timeline", "audit"], user.id);
  return event;
}

/** Rebuild all AI-derived timeline events from the current documents (human events are kept). */
export async function regenerateTimeline(user: SessionUser, caseRoomId: string) {
  assertCan(user, "timeline.edit");
  await assertCaseAccess(user, caseRoomId);
  const ctx = await buildCaseContext(caseRoomId, user.id);
  if (ctx.documents.length === 0) throw new ValidationError("Upload clinical documents first.");
  const events = await withAIRun(user, { task: "timeline" }, async (runId) => {
    const result = await getAIProvider().generateTimeline(ctx, ctx.documents);
    // Never trade an existing timeline for an empty one (the documents did not change).
    if (result.output.length === 0 && ctx.timeline.some((event) => event.createdByAI)) {
      throw new ValidationError("The AI found no timeline events, so the existing timeline was kept. Try again later.");
    }

    await prisma.$transaction(async (tx) => {
      await completeAIRunInTransaction(tx, runId);
      await tx.timelineEvent.deleteMany({ where: { caseRoomId, createdByAI: true } });
      for (const event of result.output) {
        await tx.timelineEvent.create({
          data: {
            caseRoomId,
            date: new Date(`${event.date}T00:00:00Z`),
            eventType: event.eventType,
            title: event.title.slice(0, 200),
            description: event.description,
            sourceDocumentId: event.sourceDocumentId,
            createdByAI: true,
          },
        });
      }
      await recordAudit(tx, {
        organizationId: user.organizationId,
        caseRoomId,
        userId: user.id,
        actorType: "AI",
        action: "ai.timeline_generated",
        resourceType: "CaseRoom",
        resourceId: caseRoomId,
        metadata: { events: result.output.length, documents: ctx.documents.length, provider: result.provider.id, model: result.model },
      });
      await touchCaseRoom(tx, caseRoomId);
    });
    return result.output.length;
  });
  await realtime.touch(caseRoomId, ["timeline", "audit"], user.id);
  return events;
}
