"use client";

import { Button } from "@ccr/ui/components/button";
import { Input } from "@ccr/ui/components/input";
import { Label } from "@ccr/ui/components/label";
import { Spinner } from "@ccr/ui/components/misc";
import { Building2Icon } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { signupAction, type FormState } from "@/server/actions/auth";

export default function SignupPage() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(signupAction, { error: null });
  return (
    <div className="w-full max-w-md space-y-8">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Create an organization</h2>
        <p className="text-[13px] text-muted-foreground">
          You will be the organization admin. Invite clinicians from the Team page afterwards. Use synthetic data only.
        </p>
      </div>
      <form action={formAction} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="organizationName">Organization name</Label>
          <Input id="organizationName" name="organizationName" required placeholder="Northside Cancer Institute" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="name">Your full name</Label>
          <Input id="name" name="name" required placeholder="Dr. Jane Doe" autoComplete="name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
        </div>
        {state.error && <p className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">{state.error}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? <Spinner /> : <Building2Icon />}
          Create organization
        </Button>
        <p className="text-center text-[13px] text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
