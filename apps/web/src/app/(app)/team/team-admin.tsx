"use client";

import { Button } from "@ccr/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ccr/ui/components/dialog";
import { Input } from "@ccr/ui/components/input";
import { Label } from "@ccr/ui/components/label";
import { Spinner } from "@ccr/ui/components/misc";
import { NativeSelect } from "@ccr/ui/components/native-select";
import { USER_ROLE_LABELS, USER_ROLES, type UserRole } from "@ccr/types";
import { CopyIcon, MailPlusIcon, SendIcon, UserCheckIcon, UserXIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  changeMemberRoleAction,
  deactivateMemberAction,
  inviteMemberAction,
  reactivateMemberAction,
  resendInvitationAction,
  revokeInvitationAction,
} from "@/server/actions/team";

/** Links built without APP_URL are relative; make them absolute for copying. */
function absolute(link: string): string {
  return new URL(link, window.location.origin).toString();
}

function copyLink(link: string) {
  void navigator.clipboard.writeText(absolute(link));
  toast.success("Link copied");
}

export function InviteForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  // The organization this form was opened in; kept even if the page re-renders under another one.
  const [formOrganizationId] = useState(organizationId);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("SPECIALIST");
  const [specialty, setSpecialty] = useState("");
  const [title, setTitle] = useState("");
  const [created, setCreated] = useState<{ link: string; email: string; emailed: boolean; problem: string | null } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await inviteMemberAction({ organizationId: formOrganizationId, email, role, specialty: specialty || undefined, title: title || undefined });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { inviteUrl, delivery } = result.data;
      setCreated({ link: inviteUrl, email, emailed: delivery.emailed, problem: delivery.emailed ? null : delivery.emailProblem });
      setEmail("");
      setSpecialty("");
      setTitle("");
      toast.success(delivery.emailed ? `Invitation emailed to ${email}` : "Invitation created");
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
      {created && (
        <div className="space-y-1.5 rounded-lg border border-approved-border bg-approved-soft p-3">
          <div className="text-xs font-medium text-approved">
            {created.emailed
              ? `Invitation emailed to ${created.email}. You can also share the link yourself:`
              : `${created.problem ?? "The invitation was not emailed."} Share this link with ${created.email}:`}
          </div>
          <div className="flex gap-2">
            <Input readOnly value={created.link} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button type="button" variant="outline" size="icon" aria-label="Copy invitation link" onClick={() => copyLink(created.link)}>
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

/** Copy the link of a pending invitation, or send its email again. */
export function InvitationLinkButtons({ link, invitationId, canEmail }: { link: string; invitationId: string; canEmail: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button variant="ghost" size="xs" onClick={() => copyLink(link)}>
        <CopyIcon />
        Copy link
      </Button>
      {canEmail && (
        <Button
          variant="ghost"
          size="xs"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await resendInvitationAction(invitationId);
              if (!result.ok) toast.error(result.error);
              else toast.success("Invitation email sent again");
            })
          }
        >
          {pending ? <Spinner /> : <SendIcon />}
          Resend
        </Button>
      )}
    </>
  );
}

/**
 * Deactivate (after confirmation) or reactivate a member. Deactivation keeps
 * everything the person wrote; they simply can no longer open the organization.
 */
export function MemberAccessButton({ memberId, name, deactivated }: { memberId: string; name: string; deactivated: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(action: (id: string) => ReturnType<typeof deactivateMemberAction>, success: string) {
    startTransition(async () => {
      const result = await action(memberId);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success(success);
        setConfirming(false);
        router.refresh();
      }
    });
  }

  if (deactivated) {
    return (
      <Button variant="outline" size="xs" disabled={pending} onClick={() => run(reactivateMemberAction, `${name} can sign in to this organization again`)}>
        {pending ? <Spinner /> : <UserCheckIcon />}
        Reactivate
      </Button>
    );
  }

  return (
    <>
      <Button variant="ghost" size="xs" className="text-danger hover:text-danger" onClick={() => setConfirming(true)}>
        <UserXIcon />
        Deactivate
      </Button>
      <Dialog open={confirming} onOpenChange={(open) => !pending && setConfirming(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate {name}?</DialogTitle>
            <DialogDescription>
              {name} loses access to this organization and its patient cases at their next request; a case page they have open closes within about
              20 seconds. Their messages, decisions and audit entries are kept. You can reactivate them later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={pending} onClick={() => run(deactivateMemberAction, `${name} was deactivated`)}>
              {pending ? <Spinner /> : <UserXIcon />}
              Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
