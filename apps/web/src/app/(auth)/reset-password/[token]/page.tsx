import type { Metadata } from "next";
import Link from "next/link";
import { describePasswordReset } from "@/server/services/accounts";
import { ResetPasswordForm } from "./reset-password-form";

// The token is in the URL: do not send it to other sites in the Referer header.
export const metadata: Metadata = { title: "Choose a new password", referrer: "no-referrer" };

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const reset = await describePasswordReset(token);

  if (!reset) {
    return (
      <div className="w-full max-w-md space-y-3">
        <h2 className="text-xl font-semibold">Link not valid</h2>
        <p className="text-[13px] text-muted-foreground">This reset link is invalid, was already used or has expired.</p>
        <Link href="/forgot-password" className="text-[13px] font-medium text-primary hover:underline">
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md space-y-8">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Choose a new password</h2>
        <p className="text-[13px] text-muted-foreground">
          For <span className="font-medium text-foreground">{reset.email}</span>. Your other sessions will be signed out.
        </p>
      </div>
      <ResetPasswordForm token={token} />
    </div>
  );
}
