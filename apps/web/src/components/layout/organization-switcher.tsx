"use client";

import { Button } from "@ccr/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ccr/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ccr/ui/components/dropdown-menu";
import { Input } from "@ccr/ui/components/input";
import { Label } from "@ccr/ui/components/label";
import { Spinner } from "@ccr/ui/components/misc";
import type { UserRole } from "@ccr/types";
import { USER_ROLE_LABELS } from "@ccr/types";
import { Building2Icon, CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { createOrganizationAction, switchOrganizationAction } from "@/server/actions/organizations";

export interface OrganizationOption {
  id: string;
  name: string;
  role: UserRole;
}

/** Sidebar control: shows the active organization, switches to another one, or creates a new one. */
export function OrganizationSwitcher({ activeId, organizations }: { activeId: string; organizations: OrganizationOption[] }) {
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const active = organizations.find((o) => o.id === activeId) ?? organizations[0];

  function switchTo(organizationId: string) {
    if (organizationId === activeId) return;
    startTransition(async () => {
      const result = await switchOrganizationAction(organizationId);
      // On success the action redirects; a result only comes back on failure.
      if (result && !result.ok) toast.error(result.error);
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="mt-1.5 flex w-full cursor-pointer items-center gap-2 rounded-lg border border-sidebar-border bg-card px-2.5 py-2 text-left outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring/30"
            aria-label="Switch organization"
          >
            <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white">
              {pending ? <Spinner className="size-3.5" /> : <Building2Icon className="size-3.5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-medium text-foreground">{active?.name}</div>
              <div className="truncate text-[10.5px] text-muted-foreground">
                {active ? USER_ROLE_LABELS[active.role] : ""}
                {organizations.length > 1 ? ` · ${organizations.length} orgs` : ""}
              </div>
            </div>
            <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Your organizations</DropdownMenuLabel>
          {organizations.map((organization) => (
            <DropdownMenuItem key={organization.id} onSelect={() => switchTo(organization.id)} disabled={pending}>
              <Building2Icon />
              <div className="min-w-0 flex-1">
                <div className="truncate">{organization.name}</div>
                <div className="text-[11px] text-muted-foreground">{USER_ROLE_LABELS[organization.role]}</div>
              </div>
              {organization.id === activeId && <CheckIcon className="text-primary" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <PlusIcon />
            Create organization
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateOrganizationDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function CreateOrganizationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createOrganizationAction({ name });
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !pending && onOpenChange(value)}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Create an organization</DialogTitle>
            <DialogDescription>
              You become its admin and can invite colleagues. Cases, members and audit logs are separate for each organization.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="organization-name">Organization name</Label>
            <Input id="organization-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Northside Cancer Institute" autoFocus required />
          </div>
          {error && <p className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Create organization
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Single-action switch, used by the "Open in another organization?" page. */
export function SwitchOrganizationButton({ organizationId, next, label }: { organizationId: string; next: string; label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      className="w-full"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await switchOrganizationAction(organizationId, next);
          if (result && !result.ok) toast.error(result.error);
        })
      }
    >
      {pending ? <Spinner /> : <Building2Icon />}
      {label}
    </Button>
  );
}

const ORGANIZATION_CHANNEL = "ccr-active-organization";

/**
 * Every tab announces the organization it was rendered for. When another tab
 * switches organization (the active organization is per browser), this tab
 * shows a notice instead of silently acting in the other organization.
 * The server still refuses organization-level writes from stale forms.
 */
export function ActiveOrganizationNotice({ organizationId }: { organizationId: string }) {
  const [changedTo, setChangedTo] = useState<string | null>(null);

  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(ORGANIZATION_CHANNEL);
    } catch {
      return;
    }
    channel.onmessage = (event: MessageEvent<{ organizationId?: string }>) => {
      const announced = event.data?.organizationId;
      if (announced) setChangedTo(announced === organizationId ? null : announced);
    };
    channel.postMessage({ organizationId });
    return () => channel?.close();
  }, [organizationId]);

  if (!changedTo) return null;
  return (
    <div role="alert" className="no-print flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-2 text-[13px] text-amber-900">
      <span>
        You switched organization in another tab. Reload this page before continuing, so nothing is saved in the wrong organization. Unsaved
        changes on this page will be discarded.
      </span>
      {/* A full reload remounts every form for the new organization; a soft refresh would keep their old state. */}
      <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
        Reload page
      </Button>
    </div>
  );
}
