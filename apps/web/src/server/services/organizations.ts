import "server-only";
import { lockRow, prisma, type TransactionClient } from "@ccr/database";
import { z } from "zod";
import type { SessionUser } from "../auth/session";
import { can } from "../authz/permissions";
import { NotFoundError, ValidationError } from "../errors";
import { envLimit } from "../rate-limit";
import { recordAudit } from "./audit";
import { uniqueHandle } from "./handles";

/**
 * Organizations a signed-in person belongs to. Each membership is a separate
 * `User` row; switching changes which membership the session acts as.
 */

/**
 * Check that the person belongs to `organizationId`, mark that membership as
 * recently used and record the switch in that organization's audit log (no
 * details about the person's other organizations).
 */
export async function switchOrganization(user: SessionUser, organizationId: string) {
  const membership = await prisma.user.findUnique({
    where: { identityId_organizationId: { identityId: user.identityId, organizationId } },
    select: { id: true },
  });
  if (!membership) throw new NotFoundError("You are not a member of this organization.");
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: membership.id }, data: { lastLoginAt: new Date() } });
    await recordAudit(tx, {
      organizationId,
      userId: membership.id,
      action: "auth.organization_switched",
      resourceType: "User",
      resourceId: membership.id,
    });
  });
}

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, "Organization name is required").max(120),
});

/**
 * Before adding a membership to an existing person: lock the identity (so
 * concurrent additions are counted one at a time) and enforce
 * MAX_ORGANIZATIONS_PER_ACCOUNT. The cap counts every membership, created or
 * joined, so organizations cannot be multiplied to stretch per-organization
 * AI quotas. Must be the first lock of the transaction (see LockableTable).
 */
export async function reserveMembershipSlot(tx: TransactionClient, identityId: string) {
  await lockRow(tx, "Identity", identityId);
  const limit = envLimit("MAX_ORGANIZATIONS_PER_ACCOUNT", 10);
  if (limit === 0) return;
  const memberships = await tx.user.count({ where: { identityId } });
  if (memberships >= limit) throw new ValidationError(`An account can belong to at most ${limit} organizations.`);
}

/**
 * A signed-in person creates another organization and becomes its first admin.
 * Follows the same policy as public signup (`PUBLIC_SIGNUP`).
 */
export async function createAdditionalOrganization(user: SessionUser, raw: z.input<typeof createOrganizationSchema>) {
  if (process.env.PUBLIC_SIGNUP === "false") {
    throw new ValidationError("Creating organizations is disabled on this deployment.");
  }
  const { name } = createOrganizationSchema.parse(raw);

  return prisma.$transaction(async (tx) => {
    await reserveMembershipSlot(tx, user.identityId);
    const organization = await tx.organization.create({ data: { name } });
    const member = await tx.user.create({
      data: {
        identityId: user.identityId,
        name: user.name,
        email: user.email,
        handle: await uniqueHandle(tx, organization.id, user.name),
        role: "ORG_ADMIN",
        specialty: user.specialty,
        title: user.title,
        organizationId: organization.id,
        lastLoginAt: new Date(),
      },
    });
    await recordAudit(tx, {
      organizationId: organization.id,
      userId: member.id,
      action: "org.created",
      resourceType: "Organization",
      resourceId: organization.id,
      metadata: { name: organization.name },
    });
    return organization;
  });
}

/**
 * For a case the active membership cannot open: the other organization of the
 * same person in which it can, if any (so links from another organization can
 * offer a switch instead of a 404).
 */
export async function findCaseOrganizationForPerson(user: SessionUser, caseRoomId: string) {
  const memberships = await prisma.user.findMany({
    where: { identityId: user.identityId, organizationId: { not: user.organizationId } },
    select: { id: true, organizationId: true, role: true },
  });
  if (memberships.length === 0) return null;
  const room = await prisma.caseRoom.findFirst({
    where: {
      id: caseRoomId,
      OR: memberships.map((m) => ({
        organizationId: m.organizationId,
        ...(can(m, "case.viewAll") ? {} : { members: { some: { userId: m.id } } }),
      })),
    },
    select: { organizationId: true },
  });
  return room?.organizationId ?? null;
}
