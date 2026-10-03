import { prisma } from "@ccr/database";
import type { UserRole } from "@ccr/types";
import type { SessionUser } from "@/server/auth/session";

/** Erase every table (TRUNCATE skips the row-level audit immutability trigger). */
export async function resetDatabase() {
  await prisma.$executeRawUnsafe('TRUNCATE "Organization", "Identity" RESTART IDENTITY CASCADE');
}

let counter = 0;

/** A new person (identity) with one membership. */
export async function createUser(organizationId: string, role: UserRole, name: string): Promise<SessionUser> {
  counter += 1;
  const identity = await prisma.identity.create({
    data: { email: `user${counter}@test.invalid`, name, passwordHash: "not-a-real-hash" },
  });
  return addMembership(identity, organizationId, role);
}

/** Add a membership in another organization for an existing person. */
export async function addMembership(identity: { id: string; name: string; email: string }, organizationId: string, role: UserRole): Promise<SessionUser> {
  counter += 1;
  const member = await prisma.user.create({
    data: {
      identityId: identity.id,
      name: identity.name,
      email: identity.email,
      handle: `${identity.name.replace(/\W/g, "")}${counter}`,
      role,
      organizationId,
    },
  });
  return sessionUserFor(member.id);
}

/** The SessionUser the app would build for this membership (as if its organization were active). */
export async function sessionUserFor(memberId: string): Promise<SessionUser> {
  const member = await prisma.user.findUniqueOrThrow({ where: { id: memberId }, include: { organization: true } });
  const memberships = await prisma.user.findMany({ where: { identityId: member.identityId }, include: { organization: true } });
  return {
    id: member.id,
    identityId: member.identityId,
    name: member.name,
    email: member.email,
    handle: member.handle,
    role: member.role,
    specialty: member.specialty,
    title: member.title,
    organizationId: member.organizationId,
    organizationName: member.organization.name,
    organizations: memberships.map((m) => ({ id: m.organizationId, name: m.organization.name, role: m.role })),
  };
}

/** Synthetic organization with one case and a care team. */
export async function createCareTeam(label = "Test") {
  const organization = await prisma.organization.create({ data: { name: `${label} Synthetic Hospital` } });
  const proposer = await createUser(organization.id, "DOCTOR", "Dr. Proposer");
  const reviewerA = await createUser(organization.id, "SPECIALIST", "Dr. Reviewer A");
  const reviewerB = await createUser(organization.id, "DOCTOR", "Dr. Reviewer B");
  const nurse = await createUser(organization.id, "NURSE", "Nurse Test");
  const adminA = await createUser(organization.id, "ORG_ADMIN", "Admin A");
  const adminB = await createUser(organization.id, "ORG_ADMIN", "Admin B");

  counter += 1;
  const patient = await prisma.patient.create({
    data: {
      syntheticMedicalRecordNumber: `SYN-TEST-${counter}`,
      firstName: "Synthetic",
      lastName: `Patient ${counter}`,
      dateOfBirth: new Date("1960-01-01T00:00:00Z"),
      sex: "UNKNOWN",
      primaryDiagnosis: "Synthetic test diagnosis",
      organizationId: organization.id,
    },
  });
  const caseRoom = await prisma.caseRoom.create({
    data: {
      patientId: patient.id,
      organizationId: organization.id,
      title: "Synthetic test case",
      specialty: "ONCOLOGY",
      createdById: proposer.id,
      members: { create: [proposer, reviewerA, reviewerB, nurse].map((u) => ({ userId: u.id })) },
    },
  });
  return { organization, proposer, reviewerA, reviewerB, nurse, adminA, adminB, patient, caseRoom };
}

/** Run operations concurrently and report which ones failed (instead of failing fast). */
export async function settle(...operations: Array<() => Promise<unknown>>) {
  const results = await Promise.allSettled(operations.map((operation) => operation()));
  return {
    results,
    fulfilled: results.filter((r) => r.status === "fulfilled").length,
    errors: results.flatMap((r) => (r.status === "rejected" ? [r.reason as Error] : [])),
  };
}
