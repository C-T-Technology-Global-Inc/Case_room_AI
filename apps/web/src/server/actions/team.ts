"use server";

import type { UserRole } from "@ccr/types";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { runAction } from "../action-result";
import { requireUser } from "../auth/session";
import {
  changeMemberRole,
  deactivateMember,
  inviteMember,
  reactivateMember,
  resendInvitation,
  revokeInvitation,
  type inviteSchema,
} from "../services/team";

export async function inviteMemberAction(input: z.input<typeof inviteSchema>) {
  return runAction(async () => {
    const user = await requireUser();
    const { inviteUrl, delivery } = await inviteMember(user, input);
    revalidatePath("/team");
    return { inviteUrl, delivery };
  });
}

export async function resendInvitationAction(invitationId: string) {
  return runAction(async () => {
    const user = await requireUser();
    await resendInvitation(user, invitationId);
    return null;
  });
}

export async function revokeInvitationAction(invitationId: string) {
  return runAction(async () => {
    const user = await requireUser();
    await revokeInvitation(user, invitationId);
    revalidatePath("/team");
    return null;
  });
}

export async function changeMemberRoleAction(memberId: string, role: UserRole) {
  return runAction(async () => {
    const user = await requireUser();
    await changeMemberRole(user, memberId, role);
    revalidatePath("/team");
    return null;
  });
}

export async function deactivateMemberAction(memberId: string) {
  return runAction(async () => {
    const user = await requireUser();
    await deactivateMember(user, memberId);
    revalidatePath("/team");
    return null;
  });
}

export async function reactivateMemberAction(memberId: string) {
  return runAction(async () => {
    const user = await requireUser();
    await reactivateMember(user, memberId);
    revalidatePath("/team");
    return null;
  });
}
