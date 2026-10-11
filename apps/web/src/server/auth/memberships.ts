import { prisma } from "@ccr/database";
import type { UserRole } from "@ccr/types";
import { pickActiveMembership } from "./active-organization";

/**
 * Memberships behind a session, read from the database (no Auth.js here, so
 * services, route handlers and tests can use it directly).
 */

export interface SessionUser {
  /** Membership (`User` row) in the active organization; all case data references it. */
  id: string;
  /** The person's sign-in account, shared by all their memberships. */
  identityId: string;
  name: string;
  email: string;
  handle: string;
  /** Role in the active organization. */
  role: UserRole;
  specialty: string | null;
  title: string | null;
  organizationId: string;
  organizationName: string;
  /** Every organization the person is active in, for the organization switcher. */
  organizations: Array<{ id: string; name: string; role: UserRole }>;
  /** Identity.sessionVersion this session was issued for (a password change raises it). */
  sessionVersion: number;
}

/** The SessionUser for an identity; null when none of its memberships is active. */
export async function loadSessionUser(
  identity: { id: string; sessionVersion: number },
  requestedOrganization: string | undefined,
): Promise<SessionUser | null> {
  const memberships = await prisma.user.findMany({
    where: { identityId: identity.id, deactivatedAt: null },
    include: { organization: { select: { name: true } } },
  });
  const active = pickActiveMembership(memberships, requestedOrganization);
  if (!active) return null;
  return {
    id: active.id,
    identityId: identity.id,
    name: active.name,
    email: active.email,
    handle: active.handle,
    role: active.role,
    specialty: active.specialty,
    title: active.title,
    organizationId: active.organizationId,
    organizationName: active.organization.name,
    organizations: memberships
      .map((m) => ({ id: m.organizationId, name: m.organization.name, role: m.role }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    sessionVersion: identity.sessionVersion,
  };
}

/**
 * For long-lived connections (live updates): re-check a SessionUser loaded
 * earlier. Null once the membership is deactivated or the password changed;
 * otherwise the current role.
 */
export async function recheckSessionUser(user: SessionUser): Promise<{ role: UserRole } | null> {
  const member = await prisma.user.findUnique({
    where: { id: user.id },
    select: { role: true, deactivatedAt: true, identity: { select: { sessionVersion: true } } },
  });
  if (!member || member.deactivatedAt || member.identity.sessionVersion !== user.sessionVersion) return null;
  return { role: member.role };
}

