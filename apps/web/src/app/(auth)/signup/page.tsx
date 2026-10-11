import type { Metadata } from "next";
import Link from "next/link";
import { signupAvailability } from "@/server/services/accounts";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create an organization" };
// Availability depends on the runtime configuration (PUBLIC_SIGNUP, email), not the build.
export const dynamic = "force-dynamic";

export default function SignupPage() {
  const availability = signupAvailability();
  if (!availability.open) {
    return (
      <div className="w-full max-w-md space-y-3">
        <h2 className="text-2xl font-semibold tracking-tight">Signup is not available</h2>
        <p className="text-[13px] text-muted-foreground">{availability.reason}</p>
        <Link href="/login" className="text-[13px] font-medium text-primary hover:underline">
          Go to sign in
        </Link>
      </div>
    );
  }
  return <SignupForm />;
}
