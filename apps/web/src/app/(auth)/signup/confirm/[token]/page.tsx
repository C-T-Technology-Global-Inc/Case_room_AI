import type { Metadata } from "next";
import Link from "next/link";
import { describeSignupRequest } from "@/server/services/accounts";
import { CompleteSignupForm } from "./complete-signup-form";

// The token is in the URL: do not send it to other sites in the Referer header.
export const metadata: Metadata = { title: "Confirm your email", referrer: "no-referrer" };

export default async function ConfirmSignupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const request = await describeSignupRequest(token);

  if (!request) {
    return (
      <div className="w-full max-w-md space-y-3">
        <h2 className="text-xl font-semibold">Link not valid</h2>
        <p className="text-[13px] text-muted-foreground">This confirmation link is invalid, was already used or has expired.</p>
        <div className="flex gap-4 text-[13px]">
          <Link href="/signup" className="font-medium text-primary hover:underline">
            Start the signup again
          </Link>
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md space-y-8">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Create {request.organizationName}</h2>
        <p className="text-[13px] text-muted-foreground">
          Email confirmed: <span className="font-medium text-foreground">{request.email}</span>. Choose a password to finish. You will be the admin of{" "}
          {request.organizationName}.
        </p>
      </div>
      <CompleteSignupForm token={token} />
    </div>
  );
}
