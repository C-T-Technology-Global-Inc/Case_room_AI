import "server-only";
import { hashPassword, lockRow, prisma, verifyPassword, type TransactionClient } from "@ccr/database";
import { z } from "zod";
import { appLink } from "../app-url";
import type { SessionUser } from "../auth/session";
import { consumePasswordCheck } from "../auth/limits";
import { hashLinkToken, newLinkToken } from "../auth/tokens";
import { assertFormOrganization } from "../authz/organization-context";
import { assertCan } from "../authz/permissions";
import { emailEnabled, EmailUnavailableError, sendEmail } from "../email";
import { existingAccountEmail, passwordChangedEmail, passwordResetEmail, signupConfirmationEmail } from "../email/templates";
import { ConflictError, RateLimitError, ValidationError } from "../errors";
import { recordAudit, type AuditAction } from "./audit";
import { assertActiveAdmin, createAccountWithOrganization, passwordSchema } from "./team";

/**
 * Account lifecycle: public signup with email confirmation, password reset by
 * email, password change, profile and organization name.
 *
 * Changing or resetting a password raises Identity.sessionVersion; sessions
 * issued before that are rejected on their next request (server/auth/session.ts).
 */

export const SIGNUP_LINK_HOURS = 24;
export const RESET_LINK_MINUTES = 60;

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);

function assertSignupOpen() {
  if (process.env.PUBLIC_SIGNUP === "false") {
    throw new ValidationError("Self-service signup is disabled on this deployment. Ask an organization admin for an invitation.");
  }
  if (!emailEnabled()) {
    throw new EmailUnavailableError(
      "Self-service signup needs email delivery to confirm your address, and it is not configured on this deployment. Ask an organization admin for an invitation.",
    );
  }
}

/** Whether the signup form can be used on this deployment (the page shows a notice otherwise). */
export function signupAvailability(): { open: true } | { open: false; reason: string } {
  try {
    assertSignupOpen();
    return { open: true };
  } catch (error) {
    if (error instanceof ValidationError || error instanceof EmailUnavailableError) return { open: false, reason: error.message };
    throw error;
  }
}

// ---- Public signup ---------------------------------------------------------

export const signupRequestSchema = z.object({
  organizationName: z.string().trim().min(2, "Organization name is required").max(120),
  name: z.string().trim().min(2, "Enter your full name").max(80),
  email: emailSchema,
});

/**
 * Step 1 of public signup, part 1 (in the request): check the form and that
 * signup is open. The rest runs after the response (`deliverSignupRequest`),
 * so the answer takes the same time whether or not the address has an account.
 */
export function parseSignupRequest(raw: z.input<typeof signupRequestSchema>) {
  assertSignupOpen();
  return signupRequestSchema.parse(raw);
}

/**
 * Step 1, part 2 (after the response): email a confirmation link; nothing is
 * created yet. An address that already has an account gets an "already have an
 * account" email instead. Never throws: failures are logged.
 */
export async function deliverSignupRequest(input: z.output<typeof signupRequestSchema>): Promise<void> {
  try {
    const existing = await prisma.identity.findUnique({ where: { email: input.email }, select: { name: true } });
    if (existing) {
      await sendEmail(
        existingAccountEmail({ to: input.email, name: existing.name, signInUrl: appLink("/login"), resetUrl: appLink("/forgot-password") }),
      );
      return;
    }
    const { token, tokenHash } = newLinkToken();
    await prisma.signupRequest.create({
      data: { ...input, tokenHash, expiresAt: new Date(Date.now() + SIGNUP_LINK_HOURS * 3_600_000) },
    });
    await sendEmail(
      signupConfirmationEmail({
        to: input.email,
        name: input.name,
        organizationName: input.organizationName,
        url: appLink(`/signup/confirm/${token}`),
        expiresInHours: SIGNUP_LINK_HOURS,
      }),
    );
  } catch (error) {
    console.error("[accounts] signup email not sent", error instanceof Error ? error.message : error);
  }
}

/** Both parts at once (tests and scripts). */
export async function requestSignup(raw: z.input<typeof signupRequestSchema>): Promise<void> {
  await deliverSignupRequest(parseSignupRequest(raw));
}

/** The pending signup a confirmation link belongs to, or null when it is unknown, used or expired. */
export async function describeSignupRequest(token: string) {
  const request = await prisma.signupRequest.findUnique({ where: { tokenHash: hashLinkToken(token) } });
  if (!request || request.completedAt || request.expiresAt <= new Date()) return null;
  return { email: request.email, name: request.name, organizationName: request.organizationName };
}

export const completeSignupSchema = z.object({
  token: z.string().min(20),
  password: passwordSchema,
});

const INVALID_SIGNUP_LINK = "This confirmation link is invalid, was already used or has expired. Start the signup again.";

/**
 * Step 2: the link proves the person controls the address. Creates the
 * account, the organization and the admin membership in one transaction; the
 * link is claimed in the same transaction, so it works exactly once.
 */
export async function completeSignup(raw: z.input<typeof completeSignupSchema>) {
  assertSignupOpen();
  const input = completeSignupSchema.parse(raw);
  const tokenHash = hashLinkToken(input.token);
  // Cheap check first: unknown, used or expired links never reach password hashing.
  if (!(await describeSignupRequest(input.token))) throw new ValidationError(INVALID_SIGNUP_LINK);
  return withLinkInUse(tokenHash, async () => {
    const passwordHash = await hashPassword(input.password);
    try {
      return await prisma.$transaction(async (tx) => {
        const claim = await tx.signupRequest.updateMany({
          where: { tokenHash, completedAt: null, expiresAt: { gt: new Date() } },
          data: { completedAt: new Date() },
        });
        if (claim.count !== 1) throw new ValidationError(INVALID_SIGNUP_LINK);
        const request = await tx.signupRequest.findUniqueOrThrow({ where: { tokenHash } });
        if (await tx.identity.findUnique({ where: { email: request.email }, select: { id: true } })) {
          throw new ValidationError("An account with this email already exists. Sign in instead.");
        }
        return createAccountWithOrganization(tx, {
          organizationName: request.organizationName,
          name: request.name,
          email: request.email,
          passwordHash,
        });
      });
    } catch (error) {
      // Two links for the same address completed at once: the unique email decides.
      if (isUniqueViolation(error)) throw new ValidationError("An account with this email already exists. Sign in instead.");
      throw error;
    }
  });
}

/**
 * One submission per link at a time in this process: repeating a valid link
 * in parallel cannot multiply password hashing (the claim inside the
 * transaction still decides which submission wins).
 */
const linksInUse = new Set<string>();
async function withLinkInUse<T>(tokenHash: string, work: () => Promise<T>): Promise<T> {
  if (linksInUse.has(tokenHash)) throw new ValidationError("This link is already being used. Wait a moment, then reload the page.");
  linksInUse.add(tokenHash);
  try {
    return await work();
  } finally {
    linksInUse.delete(tokenHash);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

// ---- Password reset by email -----------------------------------------------

export const passwordResetRequestSchema = z.object({ email: emailSchema });

/**
 * Forgot password, part 1 (in the request): check the form. Everything that
 * depends on whether the address has an account runs after the response
 * (`deliverPasswordReset`), so the answer and its timing are the same either way.
 */
export function parsePasswordResetRequest(raw: z.input<typeof passwordResetRequestSchema>) {
  if (!emailEnabled()) throw new EmailUnavailableError("Password reset by email is not available on this deployment. Ask the person who runs it.");
  return passwordResetRequestSchema.parse(raw);
}

/** Part 2 (after the response): email a one-time reset link if the address has an account. Never throws. */
export async function deliverPasswordReset(email: string): Promise<void> {
  try {
    const identity = await prisma.identity.findUnique({ where: { email }, select: { id: true, name: true } });
    if (!identity) return;
    const { token, tokenHash } = newLinkToken();
    await prisma.passwordResetToken.create({
      data: { identityId: identity.id, tokenHash, expiresAt: new Date(Date.now() + RESET_LINK_MINUTES * 60_000) },
    });
    await sendEmail(passwordResetEmail({ to: email, name: identity.name, url: appLink(`/reset-password/${token}`), expiresInMinutes: RESET_LINK_MINUTES }));
  } catch (error) {
    console.error("[accounts] password reset email not sent", error instanceof Error ? error.message : error);
  }
}

/** Both parts at once (tests and scripts). */
export async function requestPasswordReset(raw: z.input<typeof passwordResetRequestSchema>): Promise<void> {
  const { email } = parsePasswordResetRequest(raw);
  await deliverPasswordReset(email);
}

/** The account a reset link belongs to, or null when it is unknown, used or expired. */
export async function describePasswordReset(token: string) {
  const reset = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashLinkToken(token) },
    include: { identity: { select: { email: true } } },
  });
  if (!reset || reset.usedAt || reset.expiresAt <= new Date()) return null;
  return { identityId: reset.identityId, email: reset.identity.email };
}

export const resetPasswordSchema = z.object({
  token: z.string().min(20),
  password: passwordSchema,
});

const INVALID_RESET_LINK = "This reset link is invalid, was already used or has expired. Request a new one.";

/** Set a new password with a reset link. Signs out every existing session of the account. */
export async function resetPassword(raw: z.input<typeof resetPasswordSchema>) {
  const input = resetPasswordSchema.parse(raw);
  const tokenHash = hashLinkToken(input.token);
  // Cheap check first: unknown, used or expired links never reach password hashing.
  const pending = await describePasswordReset(input.token);
  if (!pending) throw new ValidationError(INVALID_RESET_LINK);
  const identity = await withLinkInUse(tokenHash, async () => {
    const passwordHash = await hashPassword(input.password);
    return prisma.$transaction(async (tx) => {
      // Lock order of every password write: the account first, then its reset links.
      await lockRow(tx, "Identity", pending.identityId);
      const claim = await tx.passwordResetToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claim.count !== 1) throw new ValidationError(INVALID_RESET_LINK);
      return writePassword(tx, pending.identityId, passwordHash, "account.password_reset");
    });
  });
  await notifyPasswordChanged(identity);
  return identity;
}

// ---- Password change (signed in) ---------------------------------------------

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password").max(200),
  newPassword: passwordSchema,
});

/** Change the password of the signed-in account. Other sessions are signed out. */
export async function changePassword(user: SessionUser, raw: z.input<typeof changePasswordSchema>) {
  const input = changePasswordSchema.parse(raw);
  const blocked = consumePasswordCheck(user.identityId);
  if (blocked) throw new RateLimitError(blocked);
  const verified = await prisma.identity.findUniqueOrThrow({ where: { id: user.identityId }, select: { passwordHash: true, sessionVersion: true } });
  if (verified.sessionVersion !== user.sessionVersion) throw new ConflictError(PASSWORD_CHANGED_MEANWHILE);
  if (!(await verifyPassword(input.currentPassword, verified.passwordHash))) throw new ValidationError("Your current password is incorrect.");
  if (await verifyPassword(input.newPassword, verified.passwordHash)) throw new ValidationError("Choose a password different from your current one.");
  const passwordHash = await hashPassword(input.newPassword);
  const identity = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "Identity", user.identityId);
    // The checks above ran before the lock. If a reset or another change wrote the password
    // since, the old password no longer proves anything: refuse instead of overwriting it.
    const current = await tx.identity.findUniqueOrThrow({ where: { id: user.identityId }, select: { passwordHash: true, sessionVersion: true } });
    if (current.passwordHash !== verified.passwordHash || current.sessionVersion !== verified.sessionVersion) {
      throw new ConflictError(PASSWORD_CHANGED_MEANWHILE);
    }
    return writePassword(tx, user.identityId, passwordHash, "account.password_changed");
  });
  await notifyPasswordChanged(identity);
  return identity;
}

const PASSWORD_CHANGED_MEANWHILE = "Your password was changed in the meantime (for example with a reset link). Sign in again with the current password.";

/**
 * Store a new password, end every session issued before it (sessionVersion)
 * and void any reset link still pending. The caller holds the Identity lock.
 * Recorded in the audit log of each organization the person is active in.
 */
async function writePassword(tx: TransactionClient, identityId: string, passwordHash: string, action: AuditAction) {
  const identity = await tx.identity.update({
    where: { id: identityId },
    data: { passwordHash, sessionVersion: { increment: 1 } },
    select: { id: true, email: true, name: true },
  });
  await tx.passwordResetToken.updateMany({ where: { identityId, usedAt: null }, data: { usedAt: new Date() } });
  const memberships = await tx.user.findMany({ where: { identityId, deactivatedAt: null }, select: { id: true, organizationId: true } });
  for (const member of memberships) {
    await recordAudit(tx, { organizationId: member.organizationId, userId: member.id, action, resourceType: "User", resourceId: member.id });
  }
  return identity;
}

async function notifyPasswordChanged(identity: { email: string; name: string }) {
  if (!emailEnabled()) return;
  try {
    await sendEmail(passwordChangedEmail({ to: identity.email, name: identity.name, resetUrl: appLink("/forgot-password") }));
  } catch (error) {
    console.error("[accounts] password change notice not sent", error instanceof Error ? error.message : error);
  }
}

// ---- Profile and organization name -------------------------------------------

export const updateProfileSchema = z.object({
  /** Organization the form was opened in (see assertFormOrganization). */
  organizationId: z.string().min(1),
  name: z.string().trim().min(2, "Enter your full name").max(80),
  title: z.string().trim().max(80),
  specialty: z.string().trim().max(80),
});

/**
 * The name belongs to the person and changes in every organization; title and
 * specialty belong to the membership in the active organization. The mention
 * handle stays the same so existing @mentions keep working.
 */
export async function updateProfile(user: SessionUser, raw: z.input<typeof updateProfileSchema>) {
  const input = updateProfileSchema.parse(raw);
  assertFormOrganization(user, input.organizationId);
  const next = { name: input.name, title: input.title || null, specialty: input.specialty || null };
  const before = { name: user.name, title: user.title, specialty: user.specialty };
  const changed = (Object.keys(next) as Array<keyof typeof next>).filter((key) => next[key] !== before[key]);
  if (changed.length === 0) return;
  await prisma.$transaction(async (tx) => {
    await lockRow(tx, "Identity", user.identityId);
    if (next.name !== before.name) {
      await tx.identity.update({ where: { id: user.identityId }, data: { name: next.name } });
      await tx.user.updateMany({ where: { identityId: user.identityId }, data: { name: next.name } });
    }
    await tx.user.update({ where: { id: user.id }, data: { title: next.title, specialty: next.specialty } });
    await recordAudit(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "account.profile_updated",
      resourceType: "User",
      resourceId: user.id,
      metadata: Object.fromEntries(changed.map((key) => [key, { from: before[key], to: next[key] }])),
    });
  });
}

export const renameOrganizationSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().trim().min(2, "Organization name is required").max(120),
});

export async function renameOrganization(user: SessionUser, raw: z.input<typeof renameOrganizationSchema>) {
  assertCan(user, "org.manage", "Only organization admins can rename the organization.");
  const input = renameOrganizationSchema.parse(raw);
  assertFormOrganization(user, input.organizationId);
  await prisma.$transaction(async (tx) => {
    await lockRow(tx, "Organization", user.organizationId);
    // The request may have waited behind a deactivation or demotion of this admin.
    await assertActiveAdmin(tx, user, "Only organization admins can rename the organization.");
    const organization = await tx.organization.findUniqueOrThrow({ where: { id: user.organizationId }, select: { name: true } });
    if (organization.name === input.name) return;
    await tx.organization.update({ where: { id: user.organizationId }, data: { name: input.name } });
    await recordAudit(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "org.renamed",
      resourceType: "Organization",
      resourceId: user.organizationId,
      metadata: { from: organization.name, to: input.name },
    });
  });
}
