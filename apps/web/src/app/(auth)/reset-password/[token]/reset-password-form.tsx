"use client";

import { Button } from "@ccr/ui/components/button";
import { Spinner } from "@ccr/ui/components/misc";
import { KeyRoundIcon } from "lucide-react";
import { useActionState } from "react";
import { NewPasswordFields } from "@/components/auth/new-password-fields";
import { resetPasswordAction, type FormState } from "@/server/actions/auth";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(resetPasswordAction, { error: null });
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <NewPasswordFields label="New password" />
      {state.error && <p className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">{state.error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? <Spinner /> : <KeyRoundIcon />}
        Save new password
      </Button>
    </form>
  );
}
