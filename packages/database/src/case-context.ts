import type { CaseContext } from "@ccr/types";
import { parseCaseMemory } from "@ccr/types";
import type { DbClient } from "./client";

/** YYYY-MM-DD for a date-only column (stored at UTC midnight). */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function ageOn(dateOfBirth: Date, on: Date): number {
  let age = on.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    on.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (on.getUTCMonth() === dateOfBirth.getUTCMonth() && on.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export interface LoadCaseContextOptions {
  requesterId?: string | null;
  /** Number of most recent discussion messages to include. */
  messageLimit?: number;
  now?: Date;
}

/**
 * Load the complete context of a case room for the AI layer. Callers must
 * have already verified that the requester may access this case.
 */
export async function loadCaseContext(
  db: DbClient,
  caseRoomId: string,
  options: LoadCaseContextOptions = {},
): Promise<CaseContext> {
  const now = options.now ?? new Date();
  const room = await db.caseRoom.findUniqueOrThrow({
    where: { id: caseRoomId },
    include: {
      patient: true,
      members: { include: { user: true }, orderBy: { joinedAt: "asc" } },
      documents: { include: { uploadedBy: true }, orderBy: [{ documentDate: "asc" }, { createdAt: "asc" }] },
      timeline: { orderBy: [{ date: "asc" }, { createdAt: "asc" }] },
      decisions: {
        include: {
          createdBy: true,
          approvals: { include: { user: true }, orderBy: { createdAt: "asc" } },
          sources: true,
        },
        orderBy: { number: "asc" },
      },
      tasks: { include: { assignedTo: true }, orderBy: { createdAt: "asc" } },
      memory: true,
    },
  });

  const [messages, requester] = await Promise.all([
    db.message.findMany({
      where: { caseRoomId },
      include: { author: true },
      orderBy: { createdAt: "desc" },
      take: options.messageLimit ?? 40,
    }),
    options.requesterId ? db.user.findUnique({ where: { id: options.requesterId } }) : Promise.resolve(null),
  ]);

  const { patient } = room;
  return {
    patient: {
      id: patient.id,
      displayName: `${patient.firstName} ${patient.lastName}`,
      firstName: patient.firstName,
      lastName: patient.lastName,
      age: ageOn(patient.dateOfBirth, now),
      sex: patient.sex,
      dateOfBirth: toIsoDate(patient.dateOfBirth),
      mrn: patient.syntheticMedicalRecordNumber,
      primaryDiagnosis: patient.primaryDiagnosis,
      status: patient.status,
    },
    caseRoom: { id: room.id, title: room.title, specialty: room.specialty, status: room.status },
    documents: room.documents.map((doc) => ({
      id: doc.id,
      type: doc.type,
      title: doc.title,
      date: toIsoDate(doc.documentDate),
      text: doc.rawText,
      uploadedBy: doc.uploadedBy.name,
    })),
    timeline: room.timeline.map((event) => ({
      id: event.id,
      date: toIsoDate(event.date),
      eventType: event.eventType,
      title: event.title,
      description: event.description,
      sourceDocumentId: event.sourceDocumentId,
      createdByAI: event.createdByAI,
    })),
    decisions: room.decisions.map((decision) => ({
      id: decision.id,
      number: decision.number,
      title: decision.title,
      description: decision.description,
      rationale: decision.rationale,
      status: decision.status,
      proposedBy: decision.createdBy.name,
      createdAt: decision.createdAt.toISOString(),
      finalizedAt: decision.finalizedAt?.toISOString() ?? null,
      sourceDocumentIds: decision.sources.map((source) => source.documentId),
      approvals: decision.approvals.map((approval) => ({
        reviewer: approval.user.name,
        specialty: approval.user.specialty,
        status: approval.status,
        comment: approval.comment,
      })),
    })),
    tasks: room.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      assignee: task.assignedTo?.name ?? null,
      dueDate: task.dueDate ? toIsoDate(task.dueDate) : null,
    })),
    messages: messages.reverse().map((message) => ({
      id: message.id,
      type: message.type,
      author: message.type === "AI" ? "AI assistant" : message.type === "SYSTEM" ? "System" : (message.author?.name ?? "Unknown"),
      authorSpecialty: message.author?.specialty ?? null,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
    })),
    memory: room.memory ? parseCaseMemory(room.memory.data) : null,
    team: room.members.map(({ user }) => ({
      id: user.id,
      name: user.name,
      role: user.role,
      specialty: user.specialty,
      handle: user.handle,
    })),
    requester: requester
      ? { id: requester.id, name: requester.name, role: requester.role, specialty: requester.specialty }
      : null,
    now: now.toISOString(),
  };
}
