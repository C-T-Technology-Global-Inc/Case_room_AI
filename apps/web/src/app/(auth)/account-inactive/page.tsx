import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionIdentity, getSessionUser } from "@/server/auth/session";
import { SignOutButton } from "./sign-out-button";

export const metadata: Metadata = { title: "Access deactivated" };

/** Signed in, but every membership of this account is deactivated. */
export default async function AccountInactivePage() {
  if (!(await getSessionIdentity())) redirect("/login");
  if (await getSessionUser()) redirect("/dashboard");
  return (
    <div className="w-full max-w-md space-y-4">
      <h2 className="text-2xl font-semibold tracking-tight">Access deactivated</h2>
      <p className="text-[13px] text-muted-foreground">
        Your account no longer has access to any organization: an administrator deactivated it. If you think this is a mistake, contact your
        organization admin. Your past messages and decisions are kept.
      </p>
      <SignOutButton />
    </div>
  );
}
