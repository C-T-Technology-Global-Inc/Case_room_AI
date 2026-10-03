"use client";

import { Button } from "@ccr/ui/components/button";
import { Input } from "@ccr/ui/components/input";
import { Label } from "@ccr/ui/components/label";
import { Spinner } from "@ccr/ui/components/misc";
import { useActionState, useState, useTransition } from "react";
import { acceptInviteAction, logoutAction, type FormState } from "@/server/actions/auth";
import { joinOrganizationAction } from "@/server/actions/organizations";

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(acceptInviteAction, { error: null });
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div className="space-y-1.5">
        <Label htmlFor="name">Full name (as shown to your care team)</Label>
        <Input id="name" name="name" required placeholder="Dr. Jane Doe" autoComplete="name" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Choose a password</Label>
        <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
      </div>
      {state.error && <p className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">{state.error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending && <Spinner />}
        Accept invitation
      </Button>
    </form>
  );
}

/** The signed-in person accepts with their existing account and joins one more organization. */
export function JoinOrganizationButton({ token, organizationName }: { token: string; organizationName: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-3">
      {error && <p className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
      <Button
        size="lg"
        className="w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await joinOrganizationAction(token);
            if (result && !result.ok) setError(result.error);
          })
        }
      >
        {pending && <Spinner />}
        Join {organizationName}
      </Button>
    </div>
  );
}

/** Signed in with an account the invitation was not sent to: sign out and come back to this link. */
export function SwitchAccountButton({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button variant="outline" size="lg" className="w-full" disabled={pending} onClick={() => startTransition(() => logoutAction(`/invite/${token}`))}>
      {pending && <Spinner />}
      Sign out and use another account
    </Button>
  );
}
