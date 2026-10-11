"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { after } from "next/server";
import { signIn, signOut } from "@/auth";
import { safePath } from "@/lib/safe-path";
import { consumeAccountCreation, consumeEmailRequest, consumeLinkCompletion, signInBlockedMessage } from "../auth/limits";
import { BUSY_MESSAGE, isRetryableDatabaseError } from "../db-errors";
import { AppError } from "../errors";
import {
  completeSignup,
  deliverPasswordReset,
  deliverSignupRequest,
  parsePasswordResetRequest,
  parseSignupRequest,
  resetPassword,
} from "../services/accounts";
import { acceptInvitation } from "../services/team";
import { ZodError } from "zod";

export interface FormState {
  error: string | null;
}

/** Forms that end with "check your email" instead of a redirect. */
export interface EmailFormState extends FormState {
  sent: boolean;
}

function formError(error: unknown): FormState | null {
  if (error instanceof AppError) return { error: error.message };
  if (error instanceof ZodError) return { error: error.issues[0]?.message ?? "Some fields are invalid." };
  if (isRetryableDatabaseError(error)) return { error: BUSY_MESSAGE };
  return null;
}

/** New password fields: the two entries must match (checked before anything else runs). */
function newPassword(formData: FormData): { password: string; error: string | null } {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");
  return { password, error: password === confirm ? null : "The two passwords do not match." };
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "");
  const requestHeaders = await headers();
  const blocked = signInBlockedMessage(email, requestHeaders);
  if (blocked) return { error: blocked };
  try {
    await signIn("credentials", {
      email,
      password: String(formData.get("password") ?? ""),
      redirectTo: safePath(formData.get("callbackUrl")),
    });
    return { error: null };
  } catch (error) {
    if (error instanceof AuthError) return { error: signInBlockedMessage(email, requestHeaders) ?? "Invalid email or password." };
    throw error; // includes the redirect thrown on success
  }
}

export async function logoutAction(redirectTo?: string) {
  await signOut({ redirectTo: safePath(redirectTo, "/login") });
}

/** Public signup, step 1: email a confirmation link (nothing is created yet). */
export async function signupAction(_prev: EmailFormState, formData: FormData): Promise<EmailFormState> {
  const email = String(formData.get("email") ?? "");
  const limited = consumeEmailRequest("signup", email, await headers());
  if (limited) return { error: limited, sent: false };
  try {
    const input = parseSignupRequest({
      organizationName: String(formData.get("organizationName") ?? ""),
      name: String(formData.get("name") ?? ""),
      email,
    });
    // After the response: the answer must not reveal (by content or timing) whether the address has an account.
    after(() => deliverSignupRequest(input));
    return { error: null, sent: true };
  } catch (error) {
    const known = formError(error);
    if (known) return { ...known, sent: false };
    throw error;
  }
}

/** Public signup, step 2: the confirmation link was opened; create the account and sign in. */
export async function completeSignupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { password, error: mismatch } = newPassword(formData);
  if (mismatch) return { error: mismatch };
  const requestHeaders = await headers();
  const limited = consumeLinkCompletion(requestHeaders) ?? consumeAccountCreation("signup", requestHeaders);
  if (limited) return { error: limited };
  try {
    const user = await completeSignup({ token: String(formData.get("token") ?? ""), password });
    await signIn("credentials", { email: user.email, password, redirectTo: "/dashboard" });
    return { error: null };
  } catch (error) {
    const known = formError(error);
    if (known) return known;
    throw error;
  }
}

export async function acceptInviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { password, error: mismatch } = newPassword(formData);
  if (mismatch) return { error: mismatch };
  const limited = consumeAccountCreation("invite", await headers());
  if (limited) return { error: limited };
  try {
    const user = await acceptInvitation({
      token: String(formData.get("token") ?? ""),
      name: String(formData.get("name") ?? ""),
      password,
    });
    await signIn("credentials", { email: user.email, password, redirectTo: "/dashboard" });
    return { error: null };
  } catch (error) {
    const known = formError(error);
    if (known) return known;
    throw error;
  }
}

/** "Forgot password": the answer is the same whether or not the address has an account. */
export async function forgotPasswordAction(_prev: EmailFormState, formData: FormData): Promise<EmailFormState> {
  const email = String(formData.get("email") ?? "");
  const limited = consumeEmailRequest("password-reset", email, await headers());
  if (limited) return { error: limited, sent: false };
  try {
    const request = parsePasswordResetRequest({ email });
    // After the response: the answer must not reveal (by content or timing) whether the address has an account.
    after(() => deliverPasswordReset(request.email));
    return { error: null, sent: true };
  } catch (error) {
    const known = formError(error);
    if (known) return { ...known, sent: false };
    throw error;
  }
}

/** Set a new password from an emailed link, then sign in with it. */
export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { password, error: mismatch } = newPassword(formData);
  if (mismatch) return { error: mismatch };
  const limited = consumeLinkCompletion(await headers());
  if (limited) return { error: limited };
  try {
    const identity = await resetPassword({ token: String(formData.get("token") ?? ""), password });
    await signIn("credentials", { email: identity.email, password, redirectTo: "/dashboard" });
    return { error: null };
  } catch (error) {
    const known = formError(error);
    if (known) return known;
    if (error instanceof AuthError) return { error: "Your password was changed. Sign in with the new password." };
    throw error;
  }
}
