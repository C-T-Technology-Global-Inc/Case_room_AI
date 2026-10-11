import "server-only";
import { randomBytes } from "node:crypto";
import { hashPassword, lockRow, prisma, type DbClient, type TransactionClient } from "@ccr/database";
import { USER_ROLE_LABELS, USER_ROLES, type UserRole } from "@ccr/types";
import { z } from "zod";
import type { SessionUser } from "../auth/session";
import { appLink } from "../app-url";
import { assertFormOrganization } from "../authz/organization-context";
import { assertCan } from "../authz/permissions";
import { emailEnabled, sendEmail } from "../email";
import { invitationEmail } from "../email/templates";
import { AppError, ForbiddenError, NotFoundError, RateLimitError, ValidationError } from "../errors";
import { envLimit, namedLimiter, retryText } from "../rate-limit";
import { recordAudit } from "./audit";
import { uniqueHandle } from "./handles";
import { reserveMembershipSlot } from "./organizations";

const INVITATION_TTL_DAYS = 14;

export async function listMembers(user: SessionUser) {
  return prisma.user.findMany({
    where: { organizationId: user.organizationId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      specialty: true,
      title: true,
      handle: true,
      createdAt: true,
      lastLoginAt: true,
      deactivatedAt: true,
      _count: { select: { caseMemberships: true } },
    },
    orderBy: [{ deactivatedAt: { sort: "asc", nulls: "first" } }, { role: "asc" }, { name: "asc" }],
  });
}

export async function listInvitations(user: SessionUser) {
  if (user.role !== "ORG_ADMIN") return [];
  return prisma.invitation.findMany({
    where: { organizationId: user.organizationId, status: "PENDING" },
    include: { invitedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export const inviteSchema = z.object({
  /** Organization the form was opened in (see assertFormOrganization). */
  organizationId: z.string().min(1),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  role: z.enum(USER_ROLES),
  specialty: z.string().trim().max(80).optional(),
  title: z.string().trim().max(80).optional(),
});

/**
 * Create an invitation and, when email is configured, send it to the invitee.
 * The link is always returned too, so an admin can share it another way; a
 * failed email does not undo the invitation.
 */
export async function inviteMember(user: SessionUser, raw: z.input<typeof inviteSchema>) {
  assertCan(user, "org.manage", "Only organization admins can invite members.");
  const input = inviteSchema.parse(raw);
  assertFormOrganization(user, input.organizationId);
  const invitation = await prisma.$transaction(async (tx) => {
    // Serializes invitations per organization, so the duplicate checks below cannot race.
    await lockRow(tx, "Organization", user.organizationId);
    // The request may have waited behind a deactivation or demotion of this admin.
    await assertActiveAdmin(tx, user, "Only organization admins can invite members.");
    // People may belong to several organizations; only a membership here blocks the invite.
    const existingMember = await tx.user.findFirst({ where: { organizationId: user.organizationId, email: input.email } });
    if (existingMember?.deactivatedAt) {
      throw new ValidationError("This person's access is deactivated. Reactivate them from the member list instead.");
    }
    if (existingMember) throw new ValidationError("This person is already a member of the organization.");
    const pending = await tx.invitation.findFirst({
      where: { organizationId: user.organizationId, email: input.email, status: "PENDING" },
    });
    if (pending) throw new ValidationError("This email already has a pending invitation.");

    const invitation = await tx.invitation.create({
      data: {
        organizationId: user.organizationId,
        email: input.email,
        role: input.role,
        specialty: input.specialty || null,
        title: input.title || null,
        token: randomBytes(24).toString("base64url"),
        invitedById: user.id,
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
      },
    });
    await recordAudit(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "org.member_invited",
      resourceType: "Invitation",
      resourceId: invitation.id,
      metadata: { email: input.email, role: input.role },
    });
    return invitation;
  });
  return { ...invitation, inviteUrl: invitationLink(invitation.token), delivery: await emailInvitation(user, invitation) };
}

export function invitationLink(token: string): string {
  return appLink(`/invite/${token}`);
}

type InvitationEmailResult = { emailed: true } | { emailed: false; emailProblem: string };

async function emailInvitation(
  user: SessionUser,
  invitation: { email: string; role: UserRole; token: string; expiresAt: Date },
): Promise<InvitationEmailResult> {
  if (!emailEnabled()) return { emailed: false, emailProblem: "Email delivery is not configured on this deployment." };
  try {
    await sendEmail(
      invitationEmail({
        to: invitation.email,
        organizationName: user.organizationName,
        inviterName: user.name,
        roleLabel: USER_ROLE_LABELS[invitation.role],
        url: invitationLink(invitation.token),
        expiresAt: invitation.expiresAt,
      }),
    );
    return { emailed: true };
  } catch (error) {
    if (error instanceof AppError) return { emailed: false, emailProblem: error.message };
    throw error;
  }
}

/**
 * Send the email for a pending invitation again (same link and expiry), at
 * most INVITATION_RESENDS_PER_HOUR times. The invitation is looked up in the
 * caller's organization before its allowance is touched, so admins of other
 * organizations (or unknown ids) cannot use it up.
 */
export async function resendInvitation(user: SessionUser, invitationId: string) {
  assertCan(user, "org.manage", "Only organization admins can send invitations.");
  if (!emailEnabled()) throw new ValidationError("Email delivery is not configured on this deployment. Copy the link instead.");
  await assertActiveAdmin(prisma, user, "Only organization admins can send invitations.");
  const invitation = await prisma.invitation.findFirst({
    where: { id: invitationId, organizationId: user.organizationId, status: "PENDING", expiresAt: { gt: new Date() } },
  });
  if (!invitation) throw new NotFoundError("Invitation not found, or it was already accepted, revoked or expired.");
  const wait = namedLimiter("invitation-resend", envLimit("INVITATION_RESENDS_PER_HOUR", 3), 60 * 60_000).consume(`${user.organizationId}:${invitation.id}`);
  if (wait) throw new RateLimitError(`This invitation was sent several times already. Try again in ${retryText(wait)}, or copy the link.`);
  const result = await emailInvitation(user, invitation);
  if (!result.emailed) throw new ValidationError(result.emailProblem);
}

/**
 * Revoke a pending invitation. The conditional update and the claim in
 * `acceptInvitation` touch the same row, so exactly one of them wins.
 */
export async function revokeInvitation(user: SessionUser, invitationId: string) {
  assertCan(user, "org.manage");
  await prisma.$transaction(async (tx) => {
    await lockRow(tx, "Organization", user.organizationId);
    await assertActiveAdmin(tx, user, "Only organization admins can revoke invitations.");
    const { count } = await tx.invitation.updateMany({
      where: { id: invitationId, organizationId: user.organizationId, status: "PENDING" },
      data: { status: "REVOKED" },
    });
    if (count !== 1) throw new NotFoundError("Invitation not found, or it was already accepted.");
    const invitation = await tx.invitation.findUniqueOrThrow({ where: { id: invitationId }, select: { email: true } });
    await recordAudit(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "org.invitation_revoked",
      resourceType: "Invitation",
      resourceId: invitationId,
      metadata: { email: invitation.email },
    });
  });
}

export async function getInvitation(token: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: { organization: { select: { name: true } }, invitedBy: { select: { name: true } } },
  });
  if (!invitation || invitation.status !== "PENDING" || invitation.expiresAt < new Date()) return null;
  return invitation;
}

export const passwordSchema = z.string().min(8, "Use at least 8 characters").max(200);

export const acceptInvitationSchema = z.object({
  token: z.string().min(10),
  name: z.string().trim().min(2, "Enter your full name").max(80),
  password: passwordSchema,
});

/** Claim a pending invitation inside a transaction; fails if it was revoked, accepted or expired meanwhile. */
async function claimInvitation(tx: TransactionClient, invitationId: string) {
  const claim = await tx.invitation.updateMany({
    where: { id: invitationId, status: "PENDING", expiresAt: { gt: new Date() } },
    data: { status: "ACCEPTED", acceptedAt: new Date() },
  });
  if (claim.count !== 1) throw new ValidationError("This invitation is invalid or has expired.");
}

type PendingInvitation = NonNullable<Awaited<ReturnType<typeof getInvitation>>>;

/** Create the membership an invitation grants, with its audit row. */
async function createInvitedMember(tx: TransactionClient, invitation: PendingInvitation, identity: { id: string; name: string; email: string }) {
  const member = await tx.user.create({
    data: {
      identityId: identity.id,
      name: identity.name,
      email: identity.email,
      handle: await uniqueHandle(tx, invitation.organizationId, identity.name),
      role: invitation.role,
      specialty: invitation.specialty,
      title: invitation.title,
      organizationId: invitation.organizationId,
      lastLoginAt: new Date(),
    },
  });
  await recordAudit(tx, {
    organizationId: invitation.organizationId,
    userId: member.id,
    action: "org.invitation_accepted",
    resourceType: "User",
    resourceId: member.id,
    metadata: { email: member.email, role: member.role },
  });
  return member;
}

/** Accept an invitation by creating a new account (the invited email has none yet). */
export async function acceptInvitation(raw: z.input<typeof acceptInvitationSchema>) {
  const input = acceptInvitationSchema.parse(raw);
  const invitation = await getInvitation(input.token);
  if (!invitation) throw new ValidationError("This invitation is invalid or has expired.");
  const existing = await prisma.identity.findUnique({ where: { email: invitation.email } });
  if (existing) throw new ValidationError("An account with this email already exists. Sign in to accept the invitation.");

  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    // The organization lock serializes handle allocation with other acceptances.
    await lockRow(tx, "Organization", invitation.organizationId);
    // Claim the invitation: if it was revoked or accepted meanwhile, nothing is created.
    await claimInvitation(tx, invitation.id);
    const identity = await tx.identity.create({ data: { email: invitation.email, name: input.name, passwordHash } });
    return createInvitedMember(tx, invitation, identity);
  });
}

/**
 * Accept an invitation with an existing account: the signed-in person joins one
 * more organization. The invitation must have been sent to the account's email.
 */
export async function joinOrganization(identityId: string, token: string) {
  const invitation = await getInvitation(token);
  if (!invitation) throw new ValidationError("This invitation is invalid or has expired.");
  const identity = await prisma.identity.findUnique({ where: { id: identityId } });
  if (!identity) throw new ForbiddenError("Sign in to accept the invitation.");
  if (identity.email !== invitation.email) {
    throw new ForbiddenError(`This invitation was sent to ${invitation.email}. Sign in with that account to accept it.`);
  }
  return prisma.$transaction(async (tx) => {
    // Lock order: Identity (membership cap) → Organization (handles) → Invitation (claim).
    await reserveMembershipSlot(tx, identityId);
    // Read the profile under the lock: a name change may have committed while this request waited.
    const current = await tx.identity.findUniqueOrThrow({ where: { id: identityId }, select: { id: true, name: true, email: true } });
    await lockRow(tx, "Organization", invitation.organizationId);
    const already = await tx.user.findUnique({
      where: { identityId_organizationId: { identityId, organizationId: invitation.organizationId } },
    });
    if (already?.deactivatedAt) {
      throw new ValidationError(`Your access to ${invitation.organization.name} was deactivated. Ask one of its admins to reactivate it.`);
    }
    if (already) throw new ValidationError(`You are already a member of ${invitation.organization.name}.`);
    await claimInvitation(tx, invitation.id);
    return createInvitedMember(tx, invitation, current);
  });
}

/** What the invitation page should offer to the current visitor. */
export async function describeInvitation(token: string, identityId: string | null) {
  const invitation = await getInvitation(token);
  if (!invitation) return { state: "unavailable" as const };
  if (identityId) {
    const identity = await prisma.identity.findUnique({
      where: { id: identityId },
      include: { users: { where: { organizationId: invitation.organizationId }, select: { id: true, deactivatedAt: true } } },
    });
    if (identity && identity.email === invitation.email) {
      const membership = identity.users[0];
      const state = !membership ? ("join" as const) : membership.deactivatedAt ? ("deactivated-member" as const) : ("already-member" as const);
      return { state, invitation, signedInAs: identity.email };
    }
    return { state: "wrong-account" as const, invitation, signedInAs: identity?.email ?? null };
  }
  const existing = await prisma.identity.findUnique({ where: { email: invitation.email }, select: { id: true } });
  return { state: existing ? ("sign-in" as const) : ("create-account" as const), invitation };
}

/**
 * A new account and a new organization with the account as its first admin.
 * Public signup calls this only after the email address was confirmed (see
 * services/accounts.ts), so nobody can claim an address they do not control.
 */
export async function createAccountWithOrganization(
  tx: TransactionClient,
  input: { organizationName: string; name: string; email: string; passwordHash: string },
) {
  const identity = await tx.identity.create({ data: { email: input.email, name: input.name, passwordHash: input.passwordHash } });
  const organization = await tx.organization.create({ data: { name: input.organizationName } });
  const user = await tx.user.create({
    data: {
      identityId: identity.id,
      name: input.name,
      email: input.email,
      handle: await uniqueHandle(tx, organization.id, input.name),
      role: "ORG_ADMIN",
      title: "Organization Admin",
      organizationId: organization.id,
      lastLoginAt: new Date(),
    },
  });
  await recordAudit(tx, {
    organizationId: organization.id,
    userId: user.id,
    action: "org.created",
    resourceType: "Organization",
    resourceId: organization.id,
    metadata: { name: organization.name },
  });
  return user;
}

/**
 * The acting member is still an active admin, read fresh from the database.
 * Call it after taking the organization lock: a request may have waited there
 * while the admin was deactivated or demoted.
 */
export async function assertActiveAdmin(tx: DbClient, user: SessionUser, message: string) {
  const actor = await tx.user.findUnique({ where: { id: user.id }, select: { role: true, deactivatedAt: true } });
  if (actor?.role !== "ORG_ADMIN" || actor.deactivatedAt) throw new ForbiddenError(message);
}

/** Active admins of the organization, counted inside an organization-locked transaction. */
function activeAdminCount(tx: TransactionClient, organizationId: string) {
  return tx.user.count({ where: { organizationId, role: "ORG_ADMIN", deactivatedAt: null } });
}

export async function changeMemberRole(user: SessionUser, memberId: string, role: UserRole) {
  assertCan(user, "org.manage");
  if (!USER_ROLES.includes(role)) throw new ValidationError("Unknown role");
  await prisma.$transaction(async (tx) => {
    // One membership change per organization at a time, so the admin count below is current.
    await lockRow(tx, "Organization", user.organizationId);
    await assertActiveAdmin(tx, user, "Only organization admins can change roles.");
    const member = await tx.user.findFirst({ where: { id: memberId, organizationId: user.organizationId } });
    if (!member) throw new NotFoundError("Member not found");
    if (member.deactivatedAt) throw new ValidationError("Reactivate this member before changing their role.");
    if (member.role === role) return;
    if (member.role === "ORG_ADMIN" && (await activeAdminCount(tx, user.organizationId)) <= 1) {
      throw new ValidationError("The organization needs at least one admin.");
    }
    await tx.user.update({ where: { id: memberId }, data: { role } });
    await recordAudit(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "org.member_role_changed",
      resourceType: "User",
      resourceId: memberId,
      metadata: { memberName: member.name, from: member.role, to: role },
    });
  });
}

/**
 * Remove a member's access to this organization without deleting anything:
 * their messages, decisions, approvals and audit entries keep their name. The
 * session check reads memberships on every request, so the person loses access
 * at their next request; open live connections close at the next heartbeat.
 */
export async function deactivateMember(user: SessionUser, memberId: string) {
  assertCan(user, "org.manage", "Only organization admins can deactivate members.");
  if (memberId === user.id) throw new ValidationError("You cannot deactivate your own access. Ask another admin to do it.");
  await prisma.$transaction(async (tx) => {
    await lockRow(tx, "Organization", user.organizationId);
    await assertActiveAdmin(tx, user, "Only organization admins can deactivate members.");
    const member = await tx.user.findFirst({ where: { id: memberId, organizationId: user.organizationId } });
    if (!member) throw new NotFoundError("Member not found");
    if (member.deactivatedAt) return;
    if (member.role === "ORG_ADMIN" && (await activeAdminCount(tx, user.organizationId)) <= 1) {
      throw new ValidationError("The organization needs at least one active admin.");
    }
    await tx.user.update({ where: { id: memberId }, data: { deactivatedAt: new Date() } });
    await recordAudit(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "org.member_deactivated",
      resourceType: "User",
      resourceId: memberId,
      metadata: { memberName: member.name, email: member.email },
    });
  });
}

/** Give a deactivated member their access back, with the role they had. */
export async function reactivateMember(user: SessionUser, memberId: string) {
  assertCan(user, "org.manage", "Only organization admins can reactivate members.");
  await prisma.$transaction(async (tx) => {
    await lockRow(tx, "Organization", user.organizationId);
    await assertActiveAdmin(tx, user, "Only organization admins can reactivate members.");
    const member = await tx.user.findFirst({ where: { id: memberId, organizationId: user.organizationId } });
    if (!member) throw new NotFoundError("Member not found");
    if (!member.deactivatedAt) return;
    await tx.user.update({ where: { id: memberId }, data: { deactivatedAt: null } });
    await recordAudit(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "org.member_reactivated",
      resourceType: "User",
      resourceId: memberId,
      metadata: { memberName: member.name, email: member.email },
    });
  });
}

/** Organization-wide audit trail (admins only). */
export async function listOrganizationAudit(user: SessionUser, options: { action?: string; take?: number } = {}) {
  assertCan(user, "org.audit", "Only organization admins can view the organization audit log.");
  return prisma.auditEvent.findMany({
    where: { organizationId: user.organizationId, ...(options.action ? { action: { startsWith: options.action } } : {}) },
    include: {
      user: { select: { name: true } },
      caseRoom: { select: { id: true, title: true, patient: { select: { firstName: true, lastName: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: options.take ?? 200,
  });
}
