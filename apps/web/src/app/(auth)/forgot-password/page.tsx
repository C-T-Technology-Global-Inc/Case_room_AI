import type { Metadata } from "next";
import Link from "next/link";
import { emailEnabled } from "@/server/email";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Reset your password" };
// Depends on the runtime email configuration, not the build.
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  if (!emailEnabled()) {
    return (
      <div className="w-full max-w-md space-y-3">
        <h2 className="text-2xl font-semibold tracking-tight">Reset your password</h2>
        <p className="text-[13px] text-muted-foreground">
          Password reset by email is not available on this deployment, because email delivery is not configured. Ask the person who runs it to
          reset your password.
        </p>
        <Link href="/login" className="text-[13px] font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }
  return <ForgotPasswordForm />;
}
