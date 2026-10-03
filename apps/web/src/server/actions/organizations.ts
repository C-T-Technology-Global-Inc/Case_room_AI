"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { safePath } from "@/lib/safe-path";
import { runAction } from "../action-result";
import { ACTIVE_ORGANIZATION_COOKIE, ACTIVE_ORGANIZATION_COOKIE_OPTIONS } from "../auth/active-organization";
import { getSessionIdentityId, requireUser } from "../auth/session";
import { ForbiddenError } from "../errors";
import { createAdditionalOrganization, switchOrganization, type createOrganizationSchema } from "../services/organizations";
import { joinOrganization } from "../services/team";

async function activate(organizationId: string) {
  (await cookies()).set(ACTIVE_ORGANIZATION_COOKIE, organizationId, ACTIVE_ORGANIZATION_COOKIE_OPTIONS);
  revalidatePath("/", "layout");
}

/** Work in another organization the person belongs to. */
export async function switchOrganizationAction(organizationId: string, next?: string) {
  return runAction(async () => {
    const user = await requireUser();
    await switchOrganization(user, organizationId);
    await activate(organizationId);
    redirect(safePath(next));
  });
}

/** Create an organization and switch to it; the person becomes its first admin. */
export async function createOrganizationAction(input: z.input<typeof createOrganizationSchema>) {
  return runAction(async () => {
    const user = await requireUser();
    const organization = await createAdditionalOrganization(user, input);
    await activate(organization.id);
    redirect("/team");
  });
}

/** Accept an invitation with the signed-in account, then switch to the organization. */
export async function joinOrganizationAction(token: string) {
  return runAction(async () => {
    const identityId = await getSessionIdentityId();
    if (!identityId) throw new ForbiddenError("Sign in to accept the invitation.");
    const member = await joinOrganization(identityId, token);
    await activate(member.organizationId);
    redirect("/dashboard");
  });
}
