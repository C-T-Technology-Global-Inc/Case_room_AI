import "server-only";
import { randomInt } from "node:crypto";
import { prisma } from "@ccr/database";
import type { CaseSpecialty, CaseStatus, PatientSex } from "@ccr/types";
import { CASE_STATUS_LABELS } from "@ccr/types";
import { z } from "zod";
import type { SessionUser } from "../auth/session";
import { accessibleCaseWhere, assertCaseAccess } from "../authz/case-access";
import { assertFormOrganization } from "../authz/organization-context";
import { assertCan } from "../authz/permissions";
import { ValidationError } from "../errors";
import { realtime } from "../realtime/bus";
import { recordAudit } from "./audit";
import { postSystemMessage, touchCaseRoom } from "./system-messages";

export const createCaseSchema = z.object({
  /** Organization the form was opened in (see assertFormOrganization). */
  organizationId: z.string().min(1),
  firstName: z.string().trim().min(1, "First name is required").max(60),
  lastName: z.string().trim().min(1, "Last name is required").max(60),
  dateOfBirth: z.iso.date("Date of birth is required"),
  sex: z.enum(["MALE", "FEMALE", "OTHER", "UNKNOWN"]),
  primaryDiagnosis: z.string().trim().min(2, "Primary diagnosis is required").max(200),
  title: z.string().trim().min(3, "Case title is required").max(140),
  specialty: z.enum(["ONCOLOGY", "CARDIOLOGY", "CRITICAL_CARE", "EMERGENCY", "GENERAL"]),
  memberIds: z.array(z.string()).max(30).default([]),
  confirmSynthetic: z.literal(true, { error: "Confirm that this is a synthetic demo patient." }),
});
export type CreateCaseInput = z.input<typeof createCaseSchema>;

/** Case rooms visible to the user, most recently active first. */
export async function listCases(user: SessionUser, filter: { status?: CaseStatus; query?: string } = {}) {
  const query = filter.query?.trim();
  return prisma.caseRoom.findMany({
    where: {
      ...accessibleCaseWhere(user),
      ...(filter.status ? { status: filter.status } : {}),
      ...(query
        ? {
            OR: [
              { title: { contains: query, mode: "insensitive" } },
              { patient: { firstName: { contains: query, mode: "insensitive" } } },
              { patient: { lastName: { contains: query, mode: "insensitive" } } },
              { patient: { primaryDiagnosis: { contains: query, mode: "insensitive" } } },
              { patient: { syntheticMedicalRecordNumber: { contains: query, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: {
      patient: true,
      members: { include: { user: { select: { id: true, name: true, specialty: true, role: true } } }, orderBy: { joinedAt: "asc" } },
      _count: {
        select: {
          documents: true,
          tasks: { where: { status: { not: "DONE" } } },
          decisions: { where: { status: { in: ["PROPOSED", "UNDER_REVIEW"] } } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

/** Everything the case room layout needs (header, tabs, right rail). */
export async function getCaseRoomOverview(user: SessionUser, caseRoomId: string) {
  await assertCaseAccess(user, caseRoomId);
  return prisma.caseRoom.findUniqueOrThrow({
    where: { id: caseRoomId },
    include: {
      patient: true,
      createdBy: { select: { id: true, name: true } },
      members: {
        include: { user: { select: { id: true, name: true, specialty: true, role: true, title: true, handle: true } } },
        orderBy: { joinedAt: "asc" },
      },
      memory: { select: { updatedAt: true, version: true } },
      _count: {
        select: {
          documents: true,
          timeline: true,
          messages: true,
          decisions: { where: { status: { in: ["PROPOSED", "UNDER_REVIEW"] } } },
          tasks: { where: { status: { not: "DONE" } } },
        },
      },
    },
  });
}

async function nextSyntheticMrn(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const mrn = `SYN-${randomInt(200000, 999999)}`;
    const exists = await prisma.patient.findUnique({ where: { syntheticMedicalRecordNumber: mrn } });
    if (!exists) return mrn;
  }
  throw new ValidationError("Could not allocate a synthetic MRN. Please retry.");
}

/**
 * Change marker of a case: every mutation of case data updates `updatedAt`
 * (touchCaseRoom). Realtime clients compare it on connect to detect changes
 * made between rendering the page and subscribing.
 */
export async function caseVersion(caseRoomId: string): Promise<string | null> {
  const room = await prisma.caseRoom.findUnique({ where: { id: caseRoomId }, select: { updatedAt: true } });
  return room?.updatedAt.toISOString() ?? null;
}

export async function createCase(user: SessionUser, rawInput: CreateCaseInput) {
  assertCan(user, "case.create");
  const input = createCaseSchema.parse(rawInput);
  assertFormOrganization(user, input.organizationId);

  const members = await prisma.user.findMany({
    where: { id: { in: input.memberIds }, organizationId: user.organizationId },
    select: { id: true, name: true, specialty: true },
  });
  const mrn = await nextSyntheticMrn();

  const room = await prisma.$transaction(async (tx) => {
    const patient = await tx.patient.create({
      data: {
        syntheticMedicalRecordNumber: mrn,
        firstName: input.firstName,
        lastName: input.lastName,
        dateOfBirth: new Date(`${input.dateOfBirth}T00:00:00Z`),
        sex: input.sex as PatientSex,
        primaryDiagnosis: input.primaryDiagnosis,
        organizationId: user.organizationId,
        isSynthetic: true,
      },
    });
    const room = await tx.caseRoom.create({
      data: {
        patientId: patient.id,
        organizationId: user.organizationId,
        title: input.title,
        specialty: input.specialty as CaseSpecialty,
        createdById: user.id,
        members: {
          create: [
            { userId: user.id },
            ...members.filter((m) => m.id !== user.id).map((m) => ({ userId: m.id, addedById: user.id })),
          ],
        },
      },
    });
    await postSystemMessage(tx, { caseRoomId: room.id, content: `${user.name} created this case room.`, event: "case.created" });
    await recordAudit(tx, {
      organizationId: user.organizationId,
      caseRoomId: room.id,
      userId: user.id,
      action: "case.created",
      resourceType: "CaseRoom",
      resourceId: room.id,
      metadata: { title: room.title, patient: `${patient.firstName} ${patient.lastName}`, mrn },
    });
    for (const member of members.filter((m) => m.id !== user.id)) {
      await recordAudit(tx, {
        organizationId: user.organizationId,
        caseRoomId: room.id,
        userId: user.id,
        action: "case.member_added",
        resourceType: "User",
        resourceId: member.id,
        metadata: { memberName: member.name, specialty: member.specialty },
      });
    }
    return room;
  });
  return room;
}

export async function updateCaseStatus(user: SessionUser, caseRoomId: string, status: CaseStatus) {
  assertCan(user, "case.manage");
  const room = await assertCaseAccess(user, caseRoomId);
  if (room.status === status) return room;
  await prisma.$transaction(async (tx) => {
    await tx.caseRoom.update({ where: { id: caseRoomId }, data: { status } });
    await postSystemMessage(tx, {
      caseRoomId,
      content: `${user.name} changed the case status from ${CASE_STATUS_LABELS[room.status]} to ${CASE_STATUS_LABELS[status]}.`,
      event: "case.status_changed",
    });
    await recordAudit(tx, {
      organizationId: user.organizationId,
      caseRoomId,
      userId: user.id,
      action: "case.status_changed",
      resourceType: "CaseRoom",
      resourceId: caseRoomId,
      metadata: { from: room.status, to: status },
    });
  });
  await realtime.touch(caseRoomId, ["case", "messages", "audit"], user.id);
  return room;
}

export async function addCaseMembers(user: SessionUser, caseRoomId: string, userIds: string[]) {
  assertCan(user, "case.manage", "You do not have permission to invite specialists to this case.");
  await assertCaseAccess(user, caseRoomId);
  const existing = await prisma.caseRoomMember.findMany({ where: { caseRoomId }, select: { userId: true } });
  const existingIds = new Set(existing.map((m) => m.userId));
  const candidates = await prisma.user.findMany({
    where: { id: { in: userIds }, organizationId: user.organizationId },
    select: { id: true, name: true, specialty: true },
  });
  const toAdd = candidates.filter((c) => !existingIds.has(c.id));
  if (toAdd.length === 0) throw new ValidationError("Everyone selected is already on the care team.");

  await prisma.$transaction(async (tx) => {
    for (const member of toAdd) {
      await tx.caseRoomMember.create({ data: { caseRoomId, userId: member.id, addedById: user.id } });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        caseRoomId,
        userId: user.id,
        action: "case.member_added",
        resourceType: "User",
        resourceId: member.id,
        metadata: { memberName: member.name, specialty: member.specialty },
      });
    }
    const names = toAdd.map((m) => `${m.name}${m.specialty ? ` (${m.specialty})` : ""}`).join(", ");
    await postSystemMessage(tx, { caseRoomId, content: `${user.name} added ${names} to the care team.`, event: "case.member_added" });
    await touchCaseRoom(tx, caseRoomId);
  });
  await realtime.touch(caseRoomId, ["members", "messages", "audit"], user.id);
  return toAdd;
}

/** Organization members who could be added to a case. */
export function listOrganizationMembers(user: SessionUser) {
  return prisma.user.findMany({
    where: { organizationId: user.organizationId },
    select: { id: true, name: true, specialty: true, role: true, title: true, handle: true },
    orderBy: { name: "asc" },
  });
}
