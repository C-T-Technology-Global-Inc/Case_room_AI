"use client";

import { Button } from "@ccr/ui/components/button";
import { Checkbox } from "@ccr/ui/components/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ccr/ui/components/dialog";
import { Input } from "@ccr/ui/components/input";
import { Label } from "@ccr/ui/components/label";
import { Spinner } from "@ccr/ui/components/misc";
import { Textarea } from "@ccr/ui/components/textarea";
import { DOCUMENT_TYPE_LABELS, type DocumentType } from "@ccr/types";
import { ScaleIcon, ShieldCheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { DocumentOption, UserSummary } from "@/lib/dto";
import { formatDate } from "@/lib/format";
import { createDecisionAction, reviseDecisionAction } from "@/server/actions/decisions";
import { UserAvatar } from "../../shared/user-avatar";

export interface DecisionPrefill {
  title?: string;
  description?: string;
  rationale?: string;
  sourceDocumentIds?: string[];
  reviewerIds?: string[];
  sourceMessageId?: string | null;
}

const CLINICAL_ROLES = new Set(["DOCTOR", "SPECIALIST"]);

export function DecisionDialog({
  mode,
  decisionId,
  revision,
  caseId,
  open,
  onOpenChange,
  prefill,
  members,
  documents,
  currentUserId,
}: {
  mode: "create" | "revise";
  decisionId?: string;
  /** Revision being edited (revise mode); the server refuses the edit if it changed meanwhile. */
  revision?: number;
  caseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: DecisionPrefill;
  members: UserSummary[];
  documents: DocumentOption[];
  currentUserId: string;
}) {
  const router = useRouter();
  const eligible = members.filter((m) => m.id !== currentUserId && CLINICAL_ROLES.has(m.role));
  const [title, setTitle] = useState(prefill?.title ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [rationale, setRationale] = useState(prefill?.rationale ?? "");
  const [sources, setSources] = useState<Set<string>>(new Set(prefill?.sourceDocumentIds ?? []));
  const [reviewers, setReviewers] = useState<Set<string>>(new Set(prefill?.reviewerIds ?? eligible.map((m) => m.id)));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Captured when the dialog mounts, so a refresh while editing cannot silently retarget the edit.
  const [editedRevision] = useState(revision ?? 1);

  const toggle = (set: Set<string>, update: (next: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };

  function submit() {
    setError(null);
    startTransition(async () => {
      const fields = { title, description, rationale, sourceDocumentIds: [...sources], reviewerIds: [...reviewers] };
      const result =
        mode === "create"
          ? await createDecisionAction(caseId, { ...fields, sourceMessageId: prefill?.sourceMessageId ?? null })
          : await reviseDecisionAction(caseId, decisionId!, { ...fields, expectedRevision: editedRevision });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(mode === "create" ? "Decision proposed for review" : "Decision revised; reviews reset to pending");
      onOpenChange(false);
      if (mode === "create") router.push(`/cases/${caseId}/decisions`);
      else router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(value) => (pending ? undefined : onOpenChange(value))}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScaleIcon className="size-4 text-primary" />
            {mode === "create" ? "Propose a clinical decision" : "Revise decision"}
          </DialogTitle>
          <DialogDescription>
            A proposed decision becomes final only after every selected reviewer approves it. The AI cannot approve decisions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="decision-title">Decision</Label>
            <Input id="decision-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Neoadjuvant chemotherapy before surgical re-evaluation" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="decision-description">Description</Label>
            <Textarea id="decision-description" value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-20" placeholder="What exactly is being decided, including sequencing and follow-up." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="decision-rationale">Rationale</Label>
            <Textarea id="decision-rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} className="min-h-20" placeholder="Key findings supporting the decision." />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Supporting sources</Label>
              <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-lg border p-1">
                {documents.length === 0 && <p className="p-3 text-xs text-muted-foreground">No documents in this case yet.</p>}
                {documents.map((doc) => (
                  <label key={doc.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
                    <Checkbox className="mt-0.5" checked={sources.has(doc.id)} onCheckedChange={() => toggle(sources, setSources, doc.id)} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px]">{doc.title}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {DOCUMENT_TYPE_LABELS[doc.type as DocumentType] ?? doc.type} · {formatDate(doc.date)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Required reviewers</Label>
              <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-lg border p-1">
                {eligible.length === 0 && <p className="p-3 text-xs text-muted-foreground">Invite other physicians or specialists to the case to review this decision.</p>}
                {eligible.map((member) => (
                  <label key={member.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
                    <Checkbox checked={reviewers.has(member.id)} onCheckedChange={() => toggle(reviewers, setReviewers, member.id)} />
                    <UserAvatar user={member} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px]">{member.name}</span>
                      <span className="block text-[11px] text-muted-foreground">{member.specialty}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-approved-border bg-approved-soft px-3 py-2 text-xs text-approved">
            <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0" />
            Human approval is mandatory: the decision is recorded as final only when all {reviewers.size} selected reviewer{reviewers.size === 1 ? "" : "s"} approve.
          </div>

          {error && <p className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Spinner />}
            {mode === "create" ? "Propose decision" : "Save revision"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
