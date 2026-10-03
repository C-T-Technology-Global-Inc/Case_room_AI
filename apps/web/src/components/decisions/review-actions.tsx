"use client";

import { Button } from "@ccr/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ccr/ui/components/dialog";
import { Label } from "@ccr/ui/components/label";
import { Spinner } from "@ccr/ui/components/misc";
import { Textarea } from "@ccr/ui/components/textarea";
import { CheckIcon, MessageSquareWarningIcon, PencilIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { DocumentOption, UserSummary } from "@/lib/dto";
import { reviewDecisionAction } from "@/server/actions/decisions";
import { DecisionDialog } from "../case/dialogs/decision-dialog";

type Verdict = "APPROVED" | "REJECTED" | "NEEDS_CHANGES";

const COPY: Record<Verdict, { title: string; description: string; button: string; required: boolean }> = {
  APPROVED: {
    title: "Approve decision",
    description: "Your approval is recorded with your name and time. The decision becomes final when every requested reviewer has approved.",
    button: "Approve",
    required: false,
  },
  NEEDS_CHANGES: {
    title: "Request changes",
    description: "Explain what should change. The proposer can revise the decision; all reviews then reset.",
    button: "Request changes",
    required: true,
  },
  REJECTED: {
    title: "Reject decision",
    description: "A rejection closes this decision. Explain your reasoning for the care team.",
    button: "Reject",
    required: true,
  },
};

export function ReviewActions({ caseId, decisionId, number, revision }: { caseId: string; decisionId: string; number: number; revision: number }) {
  const router = useRouter();
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  // The revision on screen when the reviewer opened the dialog; a later revision must be re-read first.
  const [readRevision, setReadRevision] = useState(revision);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!verdict) return;
    setError(null);
    startTransition(async () => {
      const result = await reviewDecisionAction(caseId, decisionId, { verdict, comment: comment || undefined, expectedRevision: readRevision });
      if (!result.ok) {
        setError(result.error);
        router.refresh();
        return;
      }
      const final = result.data.status === "APPROVED";
      toast.success(
        final ? `Decision #${number} is now the final human-approved decision` : verdict === "APPROVED" ? "Approval recorded" : verdict === "REJECTED" ? "Decision rejected" : "Changes requested",
      );
      setVerdict(null);
      setComment("");
      router.refresh();
    });
  }

  function startReview(next: Verdict) {
    setReadRevision(revision);
    setError(null);
    setVerdict(next);
  }

  const copy = verdict ? COPY[verdict] : null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="approve" size="sm" onClick={() => startReview("APPROVED")}>
          <CheckIcon />
          Approve
        </Button>
        <Button variant="outline" size="sm" onClick={() => startReview("NEEDS_CHANGES")}>
          <MessageSquareWarningIcon />
          Request changes
        </Button>
        <Button variant="outline" size="sm" className="text-danger hover:text-danger" onClick={() => startReview("REJECTED")}>
          <XIcon />
          Reject
        </Button>
      </div>
      <Dialog open={Boolean(verdict)} onOpenChange={(open) => !open && !pending && setVerdict(null)}>
        <DialogContent>
          {copy && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {copy.title} #{number}
                </DialogTitle>
                <DialogDescription>{copy.description}</DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="review-comment">Comment {copy.required ? "(required)" : "(optional)"}</Label>
                <Textarea id="review-comment" value={comment} onChange={(e) => setComment(e.target.value)} className="min-h-24" autoFocus />
              </div>
              {error && <p className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={() => setVerdict(null)} disabled={pending}>
                  Cancel
                </Button>
                <Button variant={verdict === "APPROVED" ? "approve" : verdict === "REJECTED" ? "destructive" : "default"} onClick={submit} disabled={pending}>
                  {pending && <Spinner />}
                  {copy.button}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ReviseButton(props: {
  caseId: string;
  decisionId: string;
  revision: number;
  initial: { title: string; description: string; rationale: string; sourceDocumentIds: string[]; reviewerIds: string[] };
  members: UserSummary[];
  documents: DocumentOption[];
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
      >
        <PencilIcon />
        Revise
      </Button>
      <DecisionDialog
        key={key}
        mode="revise"
        decisionId={props.decisionId}
        revision={props.revision}
        caseId={props.caseId}
        open={open}
        onOpenChange={setOpen}
        prefill={props.initial}
        members={props.members}
        documents={props.documents}
        currentUserId={props.currentUserId}
      />
    </>
  );
}
