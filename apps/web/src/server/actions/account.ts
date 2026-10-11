"use server";

import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import { ZodError, type z } from "zod";
import { signIn } from "@/auth";
import { runAction } from "../action-result";
import { requireUser } from "../auth/session";
import { BUSY_MESSAGE, isRetryableDatabaseError } from "../db-errors";
import { AppError } from "../errors";
import { changePassword, renameOrganization, updateProfile, type renameOrganizationSchema, type updateProfileSchema } from "../services/accounts";
import type { FormState } from "./auth";

/**
 * Change the password of the signed-in account. Every session issued before
 * is ended (including this one), so sign in again with the new password.
 */
export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const newPassword = String(formData.get("newPassword") ?? "");
  if (newPassword !== String(formData.get("confirmPassword") ?? "")) return { error: "The two new passwords do not match." };
  try {
    const user = await requireUser();
    const identity = await changePassword(user, { currentPassword: String(formData.get("currentPassword") ?? ""), newPassword });
    await signIn("credentials", { email: identity.email, password: newPassword, redirectTo: "/settings?password=changed" });
    return { error: null };
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    if (error instanceof AuthError) return { error: "Your password was changed. Sign in again with the new password." };
    if (error instanceof ZodError) return { error: error.issues[0]?.message ?? "Some fields are invalid." };
    if (isRetryableDatabaseError(error)) return { error: BUSY_MESSAGE };
    throw error; // includes the redirect thrown on success
  }
}

export async function updateProfileAction(input: z.input<typeof updateProfileSchema>) {
  return runAction(async () => {
    const user = await requireUser();
    await updateProfile(user, input);
    revalidatePath("/", "layout");
    return null;
  });
}

export async function renameOrganizationAction(input: z.input<typeof renameOrganizationSchema>) {
  return runAction(async () => {
    const user = await requireUser();
    await renameOrganization(user, input);
    revalidatePath("/", "layout");
    return null;
  });
}
