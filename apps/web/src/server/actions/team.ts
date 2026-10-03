"use server";

import type { UserRole } from "@ccr/types";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { runAction } from "../action-result";
import { requireUser } from "../auth/session";
import { changeMemberRole, inviteMember, revokeInvitation, type inviteSchema } from "../services/team";

function appUrl() {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export async function inviteMemberAction(input: z.input<typeof inviteSchema>) {
  return runAction(async () => {
    const user = await requireUser();
    const invitation = await inviteMember(user, input);
    revalidatePath("/team");
    return { inviteUrl: `${appUrl()}/invite/${invitation.token}` };
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
