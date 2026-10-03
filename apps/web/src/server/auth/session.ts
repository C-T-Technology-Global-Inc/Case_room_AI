import "server-only";
import { prisma } from "@ccr/database";
import type { UserRole } from "@ccr/types";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { pickActiveMembership, requestedOrganizationId } from "./active-organization";

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
  /** Every organization the person belongs to, for the organization switcher. */
  organizations: Array<{ id: string; name: string; role: UserRole }>;
}

/** Identity id of the signed-in person, or null. */
export async function getSessionIdentityId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/**
 * Current member, loaded fresh from the database once per request (roles may
 * change): the person's membership in the active organization.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const identityId = await getSessionIdentityId();
  if (!identityId) return null;
  const memberships = await prisma.user.findMany({
    where: { identityId },
    include: { organization: { select: { name: true } } },
  });
  const active = pickActiveMembership(memberships, await requestedOrganizationId());
  if (!active) return null;
  return {
    id: active.id,
    identityId,
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
  };
});

/** For pages and server actions: redirect to sign-in when there is no session. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}
