"use client";

import { Button } from "@ccr/ui/components/button";
import { Input } from "@ccr/ui/components/input";
import { Label } from "@ccr/ui/components/label";
import { Spinner } from "@ccr/ui/components/misc";
import { KeyRoundIcon, SaveIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { NewPasswordFields } from "@/components/auth/new-password-fields";
import { changePasswordAction, renameOrganizationAction, updateProfileAction } from "@/server/actions/account";
import type { FormState } from "@/server/actions/auth";

export function ProfileForm(props: { organizationId: string; name: string; title: string | null; specialty: string | null }) {
  const router = useRouter();
  // The organization this form was opened in; kept even if the page re-renders under another one.
  const [organizationId] = useState(props.organizationId);
  const [name, setName] = useState(props.name);
  const [title, setTitle] = useState(props.title ?? "");
  const [specialty, setSpecialty] = useState(props.specialty ?? "");
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateProfileAction({ organizationId, name, title, specialty });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Profile saved");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="profile-name">Full name</Label>
        <Input id="profile-name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        <p className="text-xs text-muted-foreground">Shown in every organization you belong to. Your @mention handle stays the same.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="profile-title">Title</Label>
          <Input id="profile-title" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Surgical Oncologist" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-specialty">Specialty</Label>
          <Input id="profile-specialty" maxLength={80} value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Surgical Oncology" />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Spinner /> : <SaveIcon />}
          Save profile
        </Button>
      </div>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(changePasswordAction, { error: null });
  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="currentPassword">Current password</Label>
        <Input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" />
      </div>
      <NewPasswordFields name="newPassword" label="New password" />
      {state.error && <p className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">{state.error}</p>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Spinner /> : <KeyRoundIcon />}
          Change password
        </Button>
      </div>
    </form>
  );
}

export function RenameOrganizationForm(props: { organizationId: string; name: string }) {
  const router = useRouter();
  const [organizationId] = useState(props.organizationId);
  const [name, setName] = useState(props.name);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await renameOrganizationAction({ organizationId, name });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Organization renamed");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <Input aria-label="Organization name" required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className="h-8" />
      <Button type="submit" size="sm" variant="outline" disabled={pending || name.trim() === props.name}>
        {pending ? <Spinner /> : <SaveIcon />}
        Rename
      </Button>
    </form>
  );
}
