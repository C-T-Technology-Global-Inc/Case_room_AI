import "server-only";
import { prisma } from "@ccr/database";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { requestedOrganizationId } from "./active-organization";
import { loadSessionUser, type SessionUser } from "./memberships";

export type { SessionUser } from "./memberships";

/**
 * The signed-in person's identity, or null. A session issued before the last
 * password change or reset (older sessionVersion) no longer counts.
 */
export const getSessionIdentity = cache(async (): Promise<{ id: string; sessionVersion: number } | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const identity = await prisma.identity.findUnique({ where: { id }, select: { id: true, sessionVersion: true } });
  if (!identity || identity.sessionVersion !== (session.user.sessionVersion ?? 0)) return null;
  return identity;
});

/** Identity id of the signed-in person, or null. */
export async function getSessionIdentityId(): Promise<string | null> {
  return (await getSessionIdentity())?.id ?? null;
}

/**
 * Current member, loaded fresh from the database once per request (roles may
 * change, members may be deactivated): the person's active membership in the
 * requested organization, or else in the one they used most recently.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const identity = await getSessionIdentity();
  if (!identity) return null;
  return loadSessionUser(identity, await requestedOrganizationId());
});

/**
 * For pages and server actions: redirect to sign-in when there is no session,
 * and to the "access deactivated" notice when the person has no active membership.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (user) return user;
  if (await getSessionIdentity()) redirect("/account-inactive");
  redirect("/login");
}
