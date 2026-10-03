import "server-only";
import { prisma, type Prisma } from "@ccr/database";
import { notFound, redirect } from "next/navigation";
import type { SessionUser } from "../auth/session";
import { NotFoundError } from "../errors";
import { findCaseOrganizationForPerson } from "../services/organizations";
import { can } from "./permissions";

/**
 * Case-level access control. A case room is visible to its care team members
 * and to organization admins of the same organization. Anything else behaves
 * exactly like a non-existent record, so case existence is not disclosed.
 */
export function accessibleCaseWhere(user: SessionUser): Prisma.CaseRoomWhereInput {
  return {
    organizationId: user.organizationId,
    ...(can(user, "case.viewAll") ? {} : { members: { some: { userId: user.id } } }),
  };
}

export async function findAccessibleCase(user: SessionUser, caseRoomId: string) {
  return prisma.caseRoom.findFirst({
    where: { id: caseRoomId, ...accessibleCaseWhere(user) },
    include: { patient: true },
  });
}

/** For server actions and services: throws a user-safe error. */
export async function assertCaseAccess(user: SessionUser, caseRoomId: string) {
  const room = await findAccessibleCase(user, caseRoomId);
  if (!room) throw new NotFoundError("Case not found or you are not a member of its care team.");
  return room;
}

/**
 * For pages: renders the 404 page. When the case belongs to another
 * organization of the same person (a link shared there), offers to switch.
 */
export async function requireCaseForPage(user: SessionUser, caseRoomId: string) {
  const room = await findAccessibleCase(user, caseRoomId);
  if (room) return room;
  const organizationId = await findCaseOrganizationForPerson(user, caseRoomId);
  if (organizationId) {
    redirect(`/switch-organization?${new URLSearchParams({ organization: organizationId, next: `/cases/${caseRoomId}` })}`);
  }
  notFound();
}
