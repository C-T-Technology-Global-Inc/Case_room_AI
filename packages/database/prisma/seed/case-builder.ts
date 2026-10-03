import { DemoCaseAIProvider } from "@ccr/ai";
import type {
  ApprovalStatus,
  CaseSpecialty,
  CaseStatus,
  DecisionStatus,
  DocumentType,
  PatientSex,
  PatientStatus,
  TaskPriority,
  TaskStatus,
} from "@ccr/types";
import { loadCaseContext } from "../../src/case-context";
import type { ClinicalDocument } from "../../src/generated/prisma/client";
import { at, audit, day, dobForAge, json, type SeedContext } from "./helpers";
import { buildSeedMemory, generateSeedSummary, generateSeedTimeline, generateSeedTumorBoard } from "./memory";

/** Declarative description of a seeded case room. */
export interface CaseSpec {
  patient: {
    mrn: string;
    firstName: string;
    lastName: string;
    age: number;
    birthdayMonthsAgo: number;
    sex: PatientSex;
    primaryDiagnosis: string;
    status: PatientStatus;
  };
  room: { title: string; specialty: CaseSpecialty; status: CaseStatus; createdBy: string; created: [number, string] };
  /** User keys; the creator is added automatically. */
  members: Array<[string, number, string]>;
  documents: Array<{ key: string; type: DocumentType; title: string; days: number; time: string; uploadedBy: string; text: string }>;
  messages: Array<
    | { author: string; at: [number, string]; content: string; mentions?: string[] }
    | { system: string; event: string; at: [number, string] }
    | { askAI: string; author: string; at: [number, string] }
  >;
  decision?: {
    title: string;
    description: string;
    rationale: string;
    status: DecisionStatus;
    createdBy: string;
    created: [number, string];
    sources: string[];
    approvals: Array<{ reviewer: string; status: ApprovalStatus; comment?: string; responded?: [number, string] }>;
    finalized?: [number, string];
  };
  tasks: Array<{
    title: string;
    description?: string;
    assignee: string;
    creator: string;
    status: TaskStatus;
    priority: TaskPriority;
    due: number;
    created: [number, string];
    completed?: [number, string];
    fromDecision?: boolean;
    createdByAI?: boolean;
  }>;
  summary?: { status: "DRAFT" | "APPROVED"; requestedBy: string; at: [number, string]; approvedBy?: string; approvedAt?: [number, string] };
  tumorBoard?: { requestedBy: string; at: [number, string]; approvedBy: string; approvedAt: [number, string] };
  closed?: { by: string; at: [number, string] };
}

const provider = new DemoCaseAIProvider();

export async function seedCase(ctx: SeedContext, spec: CaseSpec) {
  const { prisma, org, users } = ctx;
  const u = (key: string) => {
    const user = users[key];
    if (!user) throw new Error(`Unknown seed user ${key}`);
    return user;
  };

  const patient = await prisma.patient.create({
    data: {
      syntheticMedicalRecordNumber: spec.patient.mrn,
      firstName: spec.patient.firstName,
      lastName: spec.patient.lastName,
      dateOfBirth: dobForAge(spec.patient.age, spec.patient.birthdayMonthsAgo),
      sex: spec.patient.sex,
      primaryDiagnosis: spec.patient.primaryDiagnosis,
      status: spec.patient.status,
      organizationId: org.id,
      createdAt: at(...spec.room.created),
    },
  });

  const room = await prisma.caseRoom.create({
    data: {
      patientId: patient.id,
      organizationId: org.id,
      title: spec.room.title,
      specialty: spec.room.specialty,
      status: spec.room.status,
      createdById: u(spec.room.createdBy).id,
      createdAt: at(...spec.room.created),
    },
  });
  const caseRoomId = room.id;
  await audit(ctx, { caseRoomId, userId: u(spec.room.createdBy).id, action: "case.created", resourceType: "CaseRoom", resourceId: caseRoomId, metadata: { title: room.title, patient: `${patient.firstName} ${patient.lastName}` }, createdAt: at(...spec.room.created) });
  await prisma.message.create({
    data: { caseRoomId, type: "SYSTEM", content: `${u(spec.room.createdBy).name} created this case room.`, createdAt: at(...spec.room.created), metadata: json({ kind: "system", event: "case.created" }) },
  });

  await prisma.caseRoomMember.create({ data: { caseRoomId, userId: u(spec.room.createdBy).id, joinedAt: at(...spec.room.created) } });
  for (const [key, days, time] of spec.members) {
    if (key === spec.room.createdBy) continue;
    await prisma.caseRoomMember.create({ data: { caseRoomId, userId: u(key).id, addedById: u(spec.room.createdBy).id, joinedAt: at(days, time) } });
    await audit(ctx, { caseRoomId, userId: u(spec.room.createdBy).id, action: "case.member_added", resourceType: "User", resourceId: u(key).id, metadata: { memberName: u(key).name, specialty: u(key).specialty }, createdAt: at(days, time) });
  }

  const docs: Record<string, ClinicalDocument> = {};
  for (const spec_ of spec.documents) {
    const uploadedAt = at(spec_.days, spec_.time);
    const doc = await prisma.clinicalDocument.create({
      data: {
        caseRoomId,
        type: spec_.type,
        title: spec_.title,
        rawText: spec_.text,
        uploadedById: u(spec_.uploadedBy).id,
        documentDate: day(spec_.days),
        createdAt: uploadedAt,
        processingStatus: "COMPLETED",
        processedAt: new Date(uploadedAt.getTime() + 15_000),
        fileName: `${spec_.key}.txt`,
        mimeType: "text/plain",
        fileSize: Buffer.byteLength(spec_.text),
      },
    });
    docs[spec_.key] = doc;
    await audit(ctx, { caseRoomId, userId: u(spec_.uploadedBy).id, action: "document.uploaded", resourceType: "ClinicalDocument", resourceId: doc.id, metadata: { title: doc.title, documentType: doc.type }, createdAt: uploadedAt });
    await audit(ctx, { caseRoomId, userId: u(spec_.uploadedBy).id, actorType: "AI", action: "ai.document_processed", resourceType: "ClinicalDocument", resourceId: doc.id, metadata: { title: doc.title, timelineEvents: 1, provider: "demo" }, createdAt: new Date(uploadedAt.getTime() + 15_000) });
  }

  await generateSeedTimeline(ctx, caseRoomId);

  let decisionId: string | null = null;
  if (spec.decision) {
    const d = spec.decision;
    const decision = await prisma.decision.create({
      data: {
        caseRoomId,
        number: 1,
        title: d.title,
        description: d.description,
        rationale: d.rationale,
        status: d.status,
        createdById: u(d.createdBy).id,
        createdAt: at(...d.created),
        finalizedAt: d.finalized ? at(...d.finalized) : null,
        sources: { create: d.sources.map((key) => ({ documentId: docs[key]!.id })) },
      },
    });
    decisionId = decision.id;
    await prisma.timelineEvent.create({
      data: { caseRoomId, date: day(d.created[0]), eventType: "DECISION", title: `Decision #${decision.number} proposed`, description: `${d.title}, proposed by ${u(d.createdBy).name} for multidisciplinary review.`, createdById: u(d.createdBy).id, createdAt: at(...d.created) },
    });
    const reviewerNames = d.approvals.map((a) => u(a.reviewer).name).join(", ");
    spec.messages.push({ system: `${u(d.createdBy).name} proposed Decision #${decision.number}: ${d.title}. Reviewers: ${reviewerNames}.`, event: "decision.proposed", at: d.created });
    await audit(ctx, { caseRoomId, userId: u(d.createdBy).id, action: "decision.proposed", resourceType: "Decision", resourceId: decision.id, metadata: { number: decision.number, title: d.title }, createdAt: at(...d.created) });

    for (const approval of d.approvals) {
      await prisma.approval.create({
        data: {
          decisionId: decision.id,
          userId: u(approval.reviewer).id,
          status: approval.status,
          comment: approval.comment ?? null,
          createdAt: at(...d.created),
          respondedAt: approval.responded ? at(...approval.responded) : null,
        },
      });
      if (approval.status !== "PENDING" && approval.responded) {
        const verb = approval.status === "APPROVED" ? "approved" : approval.status === "REJECTED" ? "rejected" : "requested changes to";
        spec.messages.push({ system: `${u(approval.reviewer).name} ${verb} Decision #${decision.number}.`, event: `decision.${approval.status.toLowerCase()}`, at: approval.responded });
        const action = approval.status === "APPROVED" ? "decision.approved" : approval.status === "REJECTED" ? "decision.rejected" : "decision.changes_requested";
        await audit(ctx, { caseRoomId, userId: u(approval.reviewer).id, action, resourceType: "Decision", resourceId: decision.id, metadata: { number: decision.number, title: d.title, comment: approval.comment ?? null }, createdAt: at(...approval.responded) });
      }
    }
    if (d.status === "APPROVED" && d.finalized) {
      spec.messages.push({ system: `Decision #${decision.number} was approved by all reviewers and recorded as the final human-approved decision.`, event: "decision.finalized", at: d.finalized });
      await audit(ctx, { caseRoomId, userId: null, actorType: "SYSTEM", action: "decision.finalized", resourceType: "Decision", resourceId: decision.id, metadata: { number: decision.number, title: d.title }, createdAt: at(...d.finalized) });
    }
  }

  // Messages (sorted chronologically; AI answers are produced by the demo engine).
  const context = await loadCaseContext(prisma, caseRoomId);
  const ordered = [...spec.messages].sort((a, b) => at(...a.at).getTime() - at(...b.at).getTime());
  for (const entry of ordered) {
    const createdAt = at(...entry.at);
    if ("system" in entry) {
      await prisma.message.create({ data: { caseRoomId, type: "SYSTEM", content: entry.system, createdAt, metadata: json({ kind: "system", event: entry.event, refType: decisionId ? "decision" : null, refId: decisionId }) } });
    } else if ("askAI" in entry) {
      const question = await prisma.message.create({
        data: { caseRoomId, authorId: u(entry.author).id, type: "USER", content: `@AI ${entry.askAI}`, createdAt, metadata: json({ kind: "user", mentionedUserIds: [], mentionsAI: true }) },
      });
      await audit(ctx, { caseRoomId, userId: u(entry.author).id, action: "ai.question_asked", resourceType: "Message", resourceId: question.id, metadata: { question: entry.askAI }, createdAt });
      const result = await provider.answerCaseQuestion(context, { text: entry.askAI, requester: null });
      const answer = await prisma.message.create({
        data: {
          caseRoomId,
          type: "AI",
          content: result.output.answer,
          createdAt: new Date(createdAt.getTime() + 12_000),
          metadata: json({
            kind: "ai_answer",
            question: entry.askAI,
            questionMessageId: question.id,
            requestedById: u(entry.author).id,
            sources: result.output.sources,
            confidence: result.output.confidence,
            limitations: result.output.limitations,
            provider: provider.info.id,
            model: provider.info.model,
            droppedCitations: 0,
            latencyMs: 1200,
          }),
        },
      });
      await audit(ctx, { caseRoomId, userId: u(entry.author).id, actorType: "AI", action: "ai.answer_generated", resourceType: "Message", resourceId: answer.id, metadata: { sources: result.output.sources.length, confidence: result.output.confidence }, createdAt: answer.createdAt });
    } else {
      await prisma.message.create({
        data: {
          caseRoomId,
          authorId: u(entry.author).id,
          type: "USER",
          content: entry.content,
          createdAt,
          metadata: json({ kind: "user", mentionedUserIds: (entry.mentions ?? []).map((k) => u(k).id), mentionsAI: false }),
        },
      });
    }
  }

  for (const task of spec.tasks) {
    const created = await prisma.task.create({
      data: {
        caseRoomId,
        title: task.title,
        description: task.description ?? null,
        assignedToId: u(task.assignee).id,
        createdById: u(task.creator).id,
        status: task.status,
        priority: task.priority,
        dueDate: day(task.due),
        createdAt: at(...task.created),
        completedAt: task.completed ? at(...task.completed) : null,
        decisionId: task.fromDecision ? decisionId : null,
        createdByAI: task.createdByAI ?? false,
      },
    });
    await audit(ctx, { caseRoomId, userId: u(task.creator).id, action: "task.created", resourceType: "Task", resourceId: created.id, metadata: { title: task.title, assignee: u(task.assignee).name, aiSuggested: task.createdByAI ?? false }, createdAt: at(...task.created) });
    if (task.completed) {
      await audit(ctx, { caseRoomId, userId: u(task.assignee).id, action: "task.completed", resourceType: "Task", resourceId: created.id, metadata: { title: task.title }, createdAt: at(...task.completed) });
    }
  }

  if (spec.tumorBoard) {
    const tb = spec.tumorBoard;
    await generateSeedTumorBoard(ctx, caseRoomId, {
      requestedById: u(tb.requestedBy).id,
      createdAt: at(...tb.at),
      approvedById: u(tb.approvedBy).id,
      approvedAt: at(...tb.approvedAt),
      title: "Tumor board brief",
    });
  }

  if (spec.summary) {
    const s = spec.summary;
    await generateSeedSummary(ctx, caseRoomId, {
      requestedById: u(s.requestedBy).id,
      createdAt: at(...s.at),
      status: s.status,
      approvedById: s.approvedBy ? u(s.approvedBy).id : undefined,
      approvedAt: s.approvedAt ? at(...s.approvedAt) : undefined,
    });
  }

  await buildSeedMemory(ctx, caseRoomId);

  if (spec.closed) {
    await audit(ctx, { caseRoomId, userId: u(spec.closed.by).id, action: "case.status_changed", resourceType: "CaseRoom", resourceId: caseRoomId, metadata: { from: "REVIEWING", to: "CLOSED" }, createdAt: at(...spec.closed.at) });
  }

  const lastActivity = await prisma.message.findFirst({ where: { caseRoomId }, orderBy: { createdAt: "desc" } });
  await prisma.caseRoom.update({ where: { id: caseRoomId }, data: { updatedAt: lastActivity?.createdAt ?? room.createdAt } });
  return { caseRoomId };
}
