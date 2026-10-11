import { hashPassword, prisma, verifyPassword } from "@ccr/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addMembership, createCareTeam, resetDatabase, sessionUserFor, settle } from "@/test/integration/fixtures";
import { loadSessionUser, recheckSessionUser } from "../auth/memberships";
import { hashLinkToken } from "../auth/tokens";
import { EmailUnavailableError, memoryOutbox } from "../email";
import { ConflictError, ForbiddenError, NotFoundError, RateLimitError, ValidationError } from "../errors";
import {
  changePassword,
  completeSignup,
  describePasswordReset,
  describeSignupRequest,
  renameOrganization,
  requestPasswordReset,
  requestSignup,
  resetPassword,
  updateProfile,
} from "./accounts";
import { listOrganizationMembers } from "./cases";
import { switchOrganization } from "./organizations";
import { createTask } from "./tasks";
import { changeMemberRole, deactivateMember, inviteMember, reactivateMember, resendInvitation } from "./team";

vi.mock("@/server/realtime/bus", () => ({ realtime: { touch: vi.fn(async () => {}), publish: vi.fn(async () => {}) } }));

type Team = Awaited<ReturnType<typeof createCareTeam>>;
let riverside: Team;

beforeEach(async () => {
  await resetDatabase();
  memoryOutbox().length = 0;
  riverside = await createCareTeam("Riverside");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The token at the end of the first link to `path` in the last email to `to`. */
function tokenFromEmail(to: string, path: string): string {
  const email = memoryOutbox().filter((m) => m.to === to).at(-1);
  if (!email) throw new Error(`no email to ${to}`);
  const match = email.text.match(new RegExp(`https://case-room\\.test${path}/([A-Za-z0-9_-]+)`));
  if (!match) throw new Error(`no ${path} link in "${email.subject}"`);
  return match[1]!;
}

async function withPassword(memberId: string, password: string) {
  const member = await prisma.user.findUniqueOrThrow({ where: { id: memberId } });
  await prisma.identity.update({ where: { id: member.identityId }, data: { passwordHash: await hashPassword(password) } });
  return sessionUserFor(memberId);
}

describe("public signup with email confirmation", () => {
  const form = { organizationName: "Northside Synthetic Clinic", name: "Dr. New Admin", email: "new.admin@hospital.test" };

  it("creates nothing until the emailed link is opened, then creates the account, organization and admin once", async () => {
    await requestSignup(form);
    expect(await prisma.identity.count({ where: { email: form.email } })).toBe(0);
    expect(await prisma.organization.count({ where: { name: form.organizationName } })).toBe(0);

    const token = tokenFromEmail(form.email, "/signup/confirm");
    const stored = await prisma.signupRequest.findFirstOrThrow({ where: { email: form.email } });
    expect(stored.tokenHash).toBe(hashLinkToken(token));
    expect(stored.tokenHash).not.toContain(token);
    expect(await describeSignupRequest(token)).toMatchObject({ email: form.email, organizationName: form.organizationName });

    const admin = await completeSignup({ token, password: "synthetic-password-1" });
    expect(admin).toMatchObject({ email: form.email, role: "ORG_ADMIN" });
    const identity = await prisma.identity.findUniqueOrThrow({ where: { email: form.email } });
    expect(await verifyPassword("synthetic-password-1", identity.passwordHash)).toBe(true);
    expect(await prisma.auditEvent.count({ where: { action: "org.created", organizationId: admin.organizationId } })).toBe(1);

    // Refused because the link was used, not merely because the account now exists.
    await expect(completeSignup({ token, password: "synthetic-password-2" })).rejects.toThrow(/already used/);
    expect(await describeSignupRequest(token)).toBeNull();
    expect(await prisma.identity.count({ where: { email: form.email } })).toBe(1);
  });

  it("does not reveal existing accounts: their owner gets a sign-in email and no request is stored", async () => {
    await requestSignup({ ...form, email: riverside.nurse.email });
    expect(await prisma.signupRequest.count()).toBe(0);
    const email = memoryOutbox().at(-1)!;
    expect(email.to).toBe(riverside.nurse.email);
    expect(email.subject).toMatch(/already have/i);
    expect(email.text).toContain("https://case-room.test/forgot-password");
  });

  it("rejects expired links and addresses that got an account in the meantime", async () => {
    await requestSignup(form);
    const token = tokenFromEmail(form.email, "/signup/confirm");
    await prisma.signupRequest.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(completeSignup({ token, password: "synthetic-password-1" })).rejects.toThrow(/expired/);

    await requestSignup(form);
    const second = tokenFromEmail(form.email, "/signup/confirm");
    await prisma.identity.create({ data: { email: form.email, name: "Invited Meanwhile", passwordHash: "x" } });
    await expect(completeSignup({ token: second, password: "synthetic-password-1" })).rejects.toThrow(/already exists/);
    expect(await prisma.organization.count({ where: { name: form.organizationName } })).toBe(0);
  });

  it("creates one account when two links for the same address are used at once", async () => {
    await requestSignup(form);
    const first = tokenFromEmail(form.email, "/signup/confirm");
    await requestSignup({ ...form, organizationName: "Second Synthetic Clinic" });
    const second = tokenFromEmail(form.email, "/signup/confirm");
    const outcome = await settle(
      () => completeSignup({ token: first, password: "synthetic-password-1" }),
      () => completeSignup({ token: second, password: "synthetic-password-1" }),
    );
    expect(outcome.fulfilled).toBe(1);
    expect(outcome.errors[0]).toBeInstanceOf(ValidationError);
    expect(await prisma.identity.count({ where: { email: form.email } })).toBe(1);
  });

  it("is closed without email delivery or when public signup is off", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "none");
    await expect(requestSignup(form)).rejects.toBeInstanceOf(EmailUnavailableError);
    vi.stubEnv("EMAIL_TRANSPORT", "memory");
    vi.stubEnv("PUBLIC_SIGNUP", "false");
    await expect(requestSignup(form)).rejects.toBeInstanceOf(ValidationError);
    expect(memoryOutbox()).toHaveLength(0);
  });
});

describe("password reset by email", () => {
  it("sends nothing for unknown addresses and answers the same way", async () => {
    await expect(requestPasswordReset({ email: "nobody@hospital.test" })).resolves.toBeUndefined();
    expect(memoryOutbox()).toHaveLength(0);
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });

  it("sets the new password once, ends older sessions, voids other links and notifies the owner", async () => {
    const nurse = riverside.nurse;
    await requestPasswordReset({ email: nurse.email });
    const older = tokenFromEmail(nurse.email, "/reset-password");
    await requestPasswordReset({ email: nurse.email });
    const token = tokenFromEmail(nurse.email, "/reset-password");
    expect(await describePasswordReset(token)).toMatchObject({ email: nurse.email });

    await resetPassword({ token, password: "brand-new-password" });
    const identity = await prisma.identity.findUniqueOrThrow({ where: { id: nurse.identityId } });
    expect(await verifyPassword("brand-new-password", identity.passwordHash)).toBe(true);
    expect(identity.sessionVersion).toBe(nurse.sessionVersion + 1);
    expect(await recheckSessionUser(nurse)).toBeNull(); // the session from before the reset is over
    expect(await prisma.auditEvent.count({ where: { action: "account.password_reset", userId: nurse.id } })).toBe(1);
    expect(memoryOutbox().at(-1)!.subject).toMatch(/password was changed/i);

    await expect(resetPassword({ token, password: "another-password" })).rejects.toBeInstanceOf(ValidationError);
    await expect(resetPassword({ token: older, password: "another-password" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects expired links and lets only one of two concurrent uses through", async () => {
    await requestPasswordReset({ email: riverside.nurse.email });
    const token = tokenFromEmail(riverside.nurse.email, "/reset-password");
    const outcome = await settle(
      () => resetPassword({ token, password: "first-new-password" }),
      () => resetPassword({ token, password: "second-new-password" }),
    );
    expect(outcome.fulfilled).toBe(1);

    await requestPasswordReset({ email: riverside.nurse.email });
    const expired = tokenFromEmail(riverside.nurse.email, "/reset-password");
    await prisma.passwordResetToken.updateMany({ where: { usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await describePasswordReset(expired)).toBeNull();
    await expect(resetPassword({ token: expired, password: "third-new-password" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("is unavailable without email delivery", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "none");
    await expect(requestPasswordReset({ email: riverside.nurse.email })).rejects.toBeInstanceOf(EmailUnavailableError);
  });
});

describe("password change", () => {
  it("needs the current password, refuses the same password and ends older sessions", async () => {
    const nurse = await withPassword(riverside.nurse.id, "current-password");
    await expect(changePassword(nurse, { currentPassword: "wrong-password", newPassword: "next-password" })).rejects.toThrow(/incorrect/);
    await expect(changePassword(nurse, { currentPassword: "current-password", newPassword: "current-password" })).rejects.toThrow(/different/);

    await changePassword(nurse, { currentPassword: "current-password", newPassword: "next-password" });
    const identity = await prisma.identity.findUniqueOrThrow({ where: { id: nurse.identityId } });
    expect(await verifyPassword("next-password", identity.passwordHash)).toBe(true);
    expect(await recheckSessionUser(nurse)).toBeNull();
    expect(await loadSessionUser({ id: nurse.identityId, sessionVersion: identity.sessionVersion }, undefined)).toMatchObject({ id: nurse.id });
    expect(await prisma.auditEvent.count({ where: { action: "account.password_changed" } })).toBe(1);
  });

  it("limits guesses of the current password per account", async () => {
    const doctor = await withPassword(riverside.reviewerB.id, "current-password");
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(changePassword(doctor, { currentPassword: `guess-${attempt}`, newPassword: "next-password" })).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(changePassword(doctor, { currentPassword: "current-password", newPassword: "next-password" })).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe("deactivating members", () => {
  it("removes access everywhere in the organization but keeps the person's history", async () => {
    const nurse = riverside.nurse;
    await deactivateMember(riverside.adminA, nurse.id);

    // No session in this organization; the membership is not offered anywhere.
    expect(await loadSessionUser({ id: nurse.identityId, sessionVersion: nurse.sessionVersion }, riverside.organization.id)).toBeNull();
    expect(await recheckSessionUser(nurse)).toBeNull();
    expect((await listOrganizationMembers(riverside.adminA)).map((m) => m.id)).not.toContain(nurse.id);
    await expect(
      createTask(riverside.proposer, riverside.caseRoom.id, { title: "Synthetic follow-up", assigneeId: nurse.id, priority: "MEDIUM", dueDate: null }),
    ).rejects.toThrow(/active member/);
    await expect(changeMemberRole(riverside.adminA, nurse.id, "DOCTOR")).rejects.toThrow(/Reactivate/);
    await expect(
      inviteMember(riverside.adminA, { organizationId: riverside.organization.id, email: nurse.email, role: "NURSE" }),
    ).rejects.toThrow(/Reactivate/);
    expect(await prisma.caseRoomMember.count({ where: { userId: nurse.id } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "org.member_deactivated", resourceId: nurse.id } })).toBe(1);

    await reactivateMember(riverside.adminA, nurse.id);
    expect(await loadSessionUser({ id: nurse.identityId, sessionVersion: nurse.sessionVersion }, riverside.organization.id)).toMatchObject({ id: nurse.id });
  });

  it("keeps the person's other organizations working", async () => {
    const lakeside = await createCareTeam("Lakeside");
    const person = await prisma.identity.findUniqueOrThrow({ where: { id: riverside.nurse.identityId } });
    const inLakeside = await addMembership(person, lakeside.organization.id, "NURSE");
    await deactivateMember(riverside.adminA, riverside.nurse.id);

    // Even when the browser still asks for Riverside, the session falls back to Lakeside.
    const session = await loadSessionUser({ id: person.id, sessionVersion: person.sessionVersion }, riverside.organization.id);
    expect(session).toMatchObject({ id: inLakeside.id, organizationId: lakeside.organization.id });
    expect(session!.organizations.map((o) => o.id)).toEqual([lakeside.organization.id]);
    await expect(switchOrganization(inLakeside, riverside.organization.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("only lets active admins deactivate, never themselves, and always leaves an active admin", async () => {
    await expect(deactivateMember(riverside.proposer, riverside.nurse.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deactivateMember(riverside.adminA, riverside.adminA.id)).rejects.toBeInstanceOf(ValidationError);

    await deactivateMember(riverside.adminA, riverside.adminB.id);
    // Admin B is deactivated, so Admin A is the last active admin and cannot step down.
    await expect(changeMemberRole(riverside.adminA, riverside.adminA.id, "DOCTOR")).rejects.toThrow(/at least one admin/);
    // A deactivated admin's stale session cannot act either.
    await expect(reactivateMember(riverside.adminB, riverside.adminB.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets only one of two admins deactivating each other at the same time succeed", async () => {
    const outcome = await settle(
      () => deactivateMember(riverside.adminA, riverside.adminB.id),
      () => deactivateMember(riverside.adminB, riverside.adminA.id),
    );
    expect(outcome.fulfilled).toBe(1);
    expect(outcome.errors[0]).toBeInstanceOf(ForbiddenError);
    expect(await prisma.user.count({ where: { organizationId: riverside.organization.id, role: "ORG_ADMIN", deactivatedAt: null } })).toBe(1);
  });
});

describe("invitation emails", () => {
  it("emails the link when email is configured, and still creates the invitation when it is not", async () => {
    const invited = await inviteMember(riverside.adminA, { organizationId: riverside.organization.id, email: "colleague@hospital.test", role: "SPECIALIST" });
    expect(invited.delivery).toEqual({ emailed: true });
    expect(tokenFromEmail("colleague@hospital.test", "/invite")).toBe(invited.token);
    expect(memoryOutbox().at(-1)!.subject).toContain(riverside.organization.name);

    await resendInvitation(riverside.adminA, invited.id);
    expect(memoryOutbox().filter((m) => m.to === "colleague@hospital.test")).toHaveLength(2);

    vi.stubEnv("EMAIL_TRANSPORT", "none");
    const linkOnly = await inviteMember(riverside.adminA, { organizationId: riverside.organization.id, email: "other@hospital.test", role: "NURSE" });
    expect(linkOnly.delivery.emailed).toBe(false);
    expect(linkOnly.inviteUrl).toBe(`https://case-room.test/invite/${linkOnly.token}`);
    expect(await prisma.invitation.count({ where: { status: "PENDING" } })).toBe(2);
    await expect(resendInvitation(riverside.adminA, linkOnly.id)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("invitation resend allowance (Codex round 7)", () => {
  it("cannot be used up by an admin of another organization, and stays bounded for the owner", async () => {
    const lakeside = await createCareTeam("Lakeside");
    const invited = await inviteMember(riverside.adminA, { organizationId: riverside.organization.id, email: "guarded@hospital.test", role: "NURSE" });
    for (let attempt = 0; attempt < 4; attempt++) {
      await expect(resendInvitation(lakeside.adminA, invited.id)).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(resendInvitation(lakeside.adminA, "no-such-invitation")).rejects.toBeInstanceOf(NotFoundError);
    // Riverside still has its full allowance (3 per hour), and no more.
    for (let attempt = 0; attempt < 3; attempt++) await resendInvitation(riverside.adminA, invited.id);
    await expect(resendInvitation(riverside.adminA, invited.id)).rejects.toBeInstanceOf(RateLimitError);
    expect(memoryOutbox().filter((m) => m.to === "guarded@hospital.test")).toHaveLength(4); // the invitation plus 3 resends
  });
});

describe("profile and organization name", () => {
  it("changes the person's name everywhere and title and specialty only in this organization", async () => {
    const lakeside = await createCareTeam("Lakeside");
    const person = await prisma.identity.findUniqueOrThrow({ where: { id: riverside.reviewerA.identityId } });
    const inLakeside = await addMembership(person, lakeside.organization.id, "DOCTOR");

    await updateProfile(riverside.reviewerA, {
      organizationId: riverside.organization.id,
      name: "Dr. Renamed Reviewer",
      title: "Radiologist",
      specialty: "Radiology",
    });
    expect((await prisma.identity.findUniqueOrThrow({ where: { id: person.id } })).name).toBe("Dr. Renamed Reviewer");
    expect(await prisma.user.findUniqueOrThrow({ where: { id: inLakeside.id } })).toMatchObject({ name: "Dr. Renamed Reviewer", title: null });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: riverside.reviewerA.id } })).toMatchObject({ title: "Radiologist", specialty: "Radiology" });

    // A form opened in Riverside cannot be submitted while Lakeside is active.
    await expect(updateProfile(inLakeside, { organizationId: riverside.organization.id, name: "X Y", title: "", specialty: "" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("lets admins rename the organization", async () => {
    await expect(renameOrganization(riverside.proposer, { organizationId: riverside.organization.id, name: "Nope" })).rejects.toBeInstanceOf(ForbiddenError);
    await renameOrganization(riverside.adminA, { organizationId: riverside.organization.id, name: "Riverside Renamed" });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: riverside.organization.id } })).name).toBe("Riverside Renamed");
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "org.renamed" } });
    expect(audit.metadata).toMatchObject({ to: "Riverside Renamed" });
  });
});
