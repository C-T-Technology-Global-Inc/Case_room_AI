"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { signIn, signOut } from "@/auth";
import { safePath } from "@/lib/safe-path";
import { consumeAccountCreation, signInBlockedMessage } from "../auth/limits";
import { AppError } from "../errors";
import { acceptInvitation, createOrganization } from "../services/team";
import { ZodError } from "zod";

export interface FormState {
  error: string | null;
}


function formError(error: unknown): FormState | null {
  if (error instanceof AppError) return { error: error.message };
  if (error instanceof ZodError) return { error: error.issues[0]?.message ?? "Some fields are invalid." };
  return null;
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

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (process.env.PUBLIC_SIGNUP === "false") {
    return { error: "Self-service signup is disabled on this deployment. Ask an organization admin for an invitation." };
  }
  const limited = consumeAccountCreation("signup", await headers());
  if (limited) return { error: limited };
  const password = String(formData.get("password") ?? "");
  try {
    const user = await createOrganization({
      organizationName: String(formData.get("organizationName") ?? ""),
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
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

export async function acceptInviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const limited = consumeAccountCreation("invite", await headers());
  if (limited) return { error: limited };
  const password = String(formData.get("password") ?? "");
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
