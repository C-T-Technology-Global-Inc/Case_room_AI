"use client";

import { Button } from "@ccr/ui/components/button";
import { Input } from "@ccr/ui/components/input";
import { Label } from "@ccr/ui/components/label";
import { Spinner } from "@ccr/ui/components/misc";
import { NativeSelect } from "@ccr/ui/components/native-select";
import { USER_ROLE_LABELS, USER_ROLES, type UserRole } from "@ccr/types";
import { CopyIcon, MailPlusIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { changeMemberRoleAction, inviteMemberAction, revokeInvitationAction } from "@/server/actions/team";

export function InviteForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  // The organization this form was opened in; kept even if the page re-renders under another one.
  const [formOrganizationId] = useState(organizationId);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("SPECIALIST");
  const [specialty, setSpecialty] = useState("");
  const [title, setTitle] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await inviteMemberAction({ organizationId: formOrganizationId, email, role, specialty: specialty || undefined, title: title || undefined });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setLink(result.data.inviteUrl);
      setEmail("");
      setSpecialty("");
      setTitle("");
      toast.success("Invitation created");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@hospital.org" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-role">Role</Label>
          <NativeSelect id="invite-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {USER_ROLES.map((value) => (
              <option key={value} value={value}>
                {USER_ROLE_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-specialty">Specialty</Label>
          <Input id="invite-specialty" value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Gastroenterology" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-title">Title</Label>
          <Input id="invite-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Gastroenterologist" />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : <MailPlusIcon />}
          Create invitation
        </Button>
      </div>
      {link && (
        <div className="space-y-1.5 rounded-lg border border-approved-border bg-approved-soft p-3">
          <div className="text-xs font-medium text-approved">Invitation link (email delivery is not part of this MVP). Share it with the invitee:</div>
          <div className="flex gap-2">
            <Input readOnly value={link} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => {
                void navigator.clipboard.writeText(link);
                toast.success("Link copied");
              }}
            >
              <CopyIcon />
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

export function RevokeInvitationButton({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="xs"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await revokeInvitationAction(invitationId);
          if (!result.ok) toast.error(result.error);
          else {
            toast.success("Invitation revoked");
            router.refresh();
          }
        })
      }
    >
      <XIcon />
      Revoke
    </Button>
  );
}

export function RoleSelect({ memberId, role, disabled }: { memberId: string; role: UserRole; disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <NativeSelect
      value={role}
      disabled={disabled || pending}
      className="h-8 w-40 text-xs"
      onChange={(event) => {
        const next = event.target.value as UserRole;
        startTransition(async () => {
          const result = await changeMemberRoleAction(memberId, next);
          if (!result.ok) toast.error(result.error);
          else toast.success(`Role changed to ${USER_ROLE_LABELS[next]}`);
          router.refresh();
        });
      }}
    >
      {USER_ROLES.map((value) => (
        <option key={value} value={value}>
          {USER_ROLE_LABELS[value]}
        </option>
      ))}
    </NativeSelect>
  );
}
