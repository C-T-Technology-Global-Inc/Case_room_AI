import { prisma } from "@ccr/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addMembership, createCareTeam, resetDatabase, sessionUserFor, settle } from "@/test/integration/fixtures";
import { assertCaseAccess } from "../authz/case-access";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { createCase } from "./cases";
import { createAdditionalOrganization, findCaseOrganizationForPerson, switchOrganization } from "./organizations";
import { acceptInvitation, createOrganization, describeInvitation, inviteMember, joinOrganization } from "./team";

vi.mock("@/server/realtime/bus", () => ({ realtime: { touch: vi.fn(async () => {}), publish: vi.fn(async () => {}) } }));

type Team = Awaited<ReturnType<typeof createCareTeam>>;
let riverside: Team;
let lakeside: Team;

beforeEach(async () => {
  await resetDatabase();
  riverside = await createCareTeam("Riverside");
  lakeside = await createCareTeam("Lakeside");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const identityOf = async (memberId: string) => {
  const member = await prisma.user.findUniqueOrThrow({ where: { id: memberId }, include: { identity: true } });
  return member.identity;
};

describe("one person in several organizations", () => {
  it("keeps case access separate per organization", async () => {
    // Dr. Proposer of Riverside also joins Lakeside as a nurse.
    const person = await identityOf(riverside.proposer.id);
    const inLakeside = await addMembership(person, lakeside.organization.id, "NURSE");

    expect(inLakeside.organizations.map((o) => o.id).sort()).toEqual([riverside.organization.id, lakeside.organization.id].sort());
    await expect(assertCaseAccess(inLakeside, riverside.caseRoom.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(assertCaseAccess(riverside.proposer, riverside.caseRoom.id)).resolves.toBeTruthy();
  });

  it("finds the other organization where the person can open a case", async () => {
    const person = await identityOf(riverside.proposer.id);
    const inLakeside = await addMembership(person, lakeside.organization.id, "NURSE");
    expect(await findCaseOrganizationForPerson(inLakeside, riverside.caseRoom.id)).toBe(riverside.organization.id);

    // A person who is in Riverside but not on that case's care team gets no switch offer.
    const outsider = await identityOf(riverside.adminA.id);
    await prisma.user.update({ where: { id: riverside.adminA.id }, data: { role: "DOCTOR" } });
    const adminInLakeside = await addMembership(outsider, lakeside.organization.id, "DOCTOR");
    expect(await findCaseOrganizationForPerson(adminInLakeside, riverside.caseRoom.id)).toBeNull();
  });

  it("only switches to organizations the person belongs to", async () => {
    await expect(switchOrganization(riverside.proposer, lakeside.organization.id)).rejects.toBeInstanceOf(NotFoundError);
    const person = await identityOf(riverside.proposer.id);
    await addMembership(person, lakeside.organization.id, "DOCTOR");
    await expect(switchOrganization(riverside.proposer, lakeside.organization.id)).resolves.toBeUndefined();
  });
});

describe("invitations for people who already have an account", () => {
  it("lets an existing account join another organization with the invited role", async () => {
    const person = await identityOf(riverside.reviewerA.id);
    const invitation = await inviteMember(lakeside.adminA, { organizationId: lakeside.adminA.organizationId, email: person.email, role: "SPECIALIST", title: "Consulting Pathologist" });

    expect((await describeInvitation(invitation.token, null)).state).toBe("sign-in");
    expect((await describeInvitation(invitation.token, person.id)).state).toBe("join");

    const member = await joinOrganization(person.id, invitation.token);
    expect(member).toMatchObject({ organizationId: lakeside.organization.id, identityId: person.id, role: "SPECIALIST", title: "Consulting Pathologist" });
    expect(await prisma.identity.count({ where: { email: person.email } })).toBe(1);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "org.invitation_accepted", userId: member.id } });
    expect(audit.organizationId).toBe(lakeside.organization.id);
  });

  it("refuses an invitation sent to another email, and does not consume it", async () => {
    const invitation = await inviteMember(lakeside.adminA, { organizationId: lakeside.adminA.organizationId, email: "someone-else@test.invalid", role: "NURSE" });
    const person = await identityOf(riverside.nurse.id);
    expect((await describeInvitation(invitation.token, person.id)).state).toBe("wrong-account");
    await expect(joinOrganization(person.id, invitation.token)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe("PENDING");
  });

  it("does not create a second account for an email that already has one", async () => {
    const person = await identityOf(riverside.nurse.id);
    const invitation = await inviteMember(lakeside.adminA, { organizationId: lakeside.adminA.organizationId, email: person.email, role: "NURSE" });
    await expect(acceptInvitation({ token: invitation.token, name: "Duplicate", password: "synthetic-password" })).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma.identity.count({ where: { email: person.email } })).toBe(1);
  });

  it("blocks inviting someone who is already a member of this organization only", async () => {
    await expect(inviteMember(riverside.adminA, { organizationId: riverside.adminA.organizationId, email: riverside.nurse.email, role: "NURSE" })).rejects.toThrow(/already a member/);
    await expect(inviteMember(lakeside.adminA, { organizationId: lakeside.adminA.organizationId, email: riverside.nurse.email, role: "NURSE" })).resolves.toBeTruthy();
  });

  it("refuses a second membership in the same organization", async () => {
    const person = await identityOf(riverside.reviewerB.id);
    await addMembership(person, lakeside.organization.id, "DOCTOR");
    await prisma.invitation.create({
      data: {
        organizationId: lakeside.organization.id,
        email: person.email,
        role: "NURSE",
        token: "synthetic-duplicate-membership-token",
        invitedById: lakeside.adminA.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    expect((await describeInvitation("synthetic-duplicate-membership-token", person.id)).state).toBe("already-member");
    await expect(joinOrganization(person.id, "synthetic-duplicate-membership-token")).rejects.toThrow(/already a member/);
  });
});

describe("creating organizations", () => {
  it("makes the creator the first admin of a new, separate organization", async () => {
    const organization = await createAdditionalOrganization(riverside.proposer, { name: "Northside Synthetic Institute" });
    const member = await prisma.user.findUniqueOrThrow({
      where: { identityId_organizationId: { identityId: riverside.proposer.identityId, organizationId: organization.id } },
    });
    expect(member.role).toBe("ORG_ADMIN");
    const refreshed = await sessionUserFor(riverside.proposer.id);
    expect(refreshed.organizations).toHaveLength(2);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "org.created", resourceId: organization.id } });
    expect(audit.userId).toBe(member.id);
  });

  it("follows the signup policy and the membership cap", async () => {
    vi.stubEnv("PUBLIC_SIGNUP", "false");
    await expect(createAdditionalOrganization(riverside.proposer, { name: "Blocked Org" })).rejects.toBeInstanceOf(ValidationError);
    vi.stubEnv("PUBLIC_SIGNUP", "true");
    vi.stubEnv("MAX_ORGANIZATIONS_PER_ACCOUNT", "1");
    await expect(createAdditionalOrganization(riverside.proposer, { name: "Capped Org" })).rejects.toThrow(/at most 1/);
  });

  it("sends existing accounts to sign in instead of signing up again", async () => {
    await expect(
      createOrganization({ organizationName: "Duplicate Org", name: "Someone", email: riverside.nurse.email, password: "synthetic-password" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("round 2: organization context and concurrency", () => {
  it("refuses organization-level writes from a form opened in another organization (M1)", async () => {
    const person = await identityOf(riverside.adminA.id);
    const adminInLakeside = await addMembership(person, lakeside.organization.id, "ORG_ADMIN");
    // The form was opened while Riverside was active; the browser has switched to Lakeside since.
    await expect(
      createCase(adminInLakeside, {
        organizationId: riverside.organization.id,
        firstName: "Synthetic",
        lastName: "Stale",
        dateOfBirth: "1970-01-01",
        sex: "UNKNOWN",
        primaryDiagnosis: "Synthetic diagnosis",
        title: "Stale form case",
        specialty: "ONCOLOGY",
        confirmSynthetic: true,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(inviteMember(adminInLakeside, { organizationId: riverside.organization.id, email: "stale@test.invalid", role: "NURSE" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await prisma.caseRoom.count({ where: { title: "Stale form case" } })).toBe(0);
    expect(await prisma.invitation.count({ where: { email: "stale@test.invalid" } })).toBe(0);
  });

  it("enforces the membership cap under concurrent creation and on invitations (M3)", async () => {
    vi.stubEnv("MAX_ORGANIZATIONS_PER_ACCOUNT", "2");
    const outcome = await settle(
      ...Array.from({ length: 6 }, (_, i) => () => createAdditionalOrganization(riverside.proposer, { name: `Concurrent Org ${i}` })),
    );
    expect(outcome.fulfilled).toBe(1);
    expect(await prisma.user.count({ where: { identityId: riverside.proposer.identityId } })).toBe(2);

    const invitation = await inviteMember(lakeside.adminA, { organizationId: lakeside.organization.id, email: riverside.proposer.email, role: "DOCTOR" });
    await expect(joinOrganization(riverside.proposer.identityId, invitation.token)).rejects.toThrow(/at most 2/);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe("PENDING");
  });

  it("gives distinct handles to people with the same name joining at once (M4)", async () => {
    const people = await Promise.all(
      ["first", "second", "third"].map((label) =>
        prisma.identity.create({ data: { email: `jane.${label}@test.invalid`, name: "Dr. Jane Doe", passwordHash: "not-a-real-hash" } }),
      ),
    );
    const invitations: Array<{ token: string }> = [];
    for (const person of people) {
      invitations.push(await inviteMember(lakeside.adminA, { organizationId: lakeside.organization.id, email: person.email, role: "DOCTOR" }));
    }
    const outcome = await settle(...people.map((person, i) => () => joinOrganization(person.id, invitations[i]!.token)));
    expect(outcome.errors).toEqual([]);
    const handles = (await prisma.user.findMany({ where: { organizationId: lakeside.organization.id, name: "Dr. Jane Doe" } })).map((u) => u.handle);
    expect(new Set(handles).size).toBe(3);
  });

  it("records organization switches in the destination organization's audit log only (M5)", async () => {
    const person = await identityOf(riverside.proposer.id);
    const inLakeside = await addMembership(person, lakeside.organization.id, "DOCTOR");
    await switchOrganization(riverside.proposer, lakeside.organization.id);
    const rows = await prisma.auditEvent.findMany({ where: { action: "auth.organization_switched" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ organizationId: lakeside.organization.id, userId: inLakeside.id, metadata: null });
  });
});
