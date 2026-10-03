import "server-only";
import type { DbClient, Prisma } from "@ccr/database";
import type { ActorType } from "@ccr/types";

/**
 * Canonical audit actions. Audit rows are append-only: the database rejects
 * UPDATE and DELETE on the AuditEvent table.
 */
export type AuditAction =
  | "auth.signed_in"
  | "auth.organization_switched"
  | "org.created"
  | "org.member_invited"
  | "org.invitation_revoked"
  | "org.invitation_accepted"
  | "org.member_role_changed"
  | "case.created"
  | "case.status_changed"
  | "case.member_added"
  | "document.uploaded"
  | "ai.document_processed"
  | "ai.document_failed"
  | "timeline.event_added"
  | "ai.timeline_generated"
  | "message.posted"
  | "ai.question_asked"
  | "ai.answer_generated"
  | "ai.answer_failed"
  | "ai.summary_generated"
  | "summary.reviewed"
  | "tumor_board.generated"
  | "handoff.generated"
  | "brief.edited"
  | "brief.approved"
  | "decision.proposed"
  | "decision.revised"
  | "decision.approved"
  | "decision.rejected"
  | "decision.changes_requested"
  | "decision.finalized"
  | "ai.tasks_suggested"
  | "task.created"
  | "task.status_changed"
  | "task.completed";

export interface AuditInput {
  organizationId: string;
  caseRoomId?: string | null;
  /** The human who acted, or on whose behalf the AI/system acted. */
  userId?: string | null;
  actorType?: ActorType;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(db: DbClient, input: AuditInput): Promise<void> {
  await db.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      caseRoomId: input.caseRoomId ?? null,
      userId: input.userId ?? null,
      actorType: input.actorType ?? "USER",
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : undefined,
    },
  });
}
