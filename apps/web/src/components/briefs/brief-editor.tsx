"use client";

import { Button } from "@ccr/ui/components/button";
import { Spinner } from "@ccr/ui/components/misc";
import { Textarea } from "@ccr/ui/components/textarea";
import type { BriefType, SectionsContent } from "@ccr/types";
import { CheckIcon, InfoIcon, PencilIcon, PrinterIcon, SaveIcon, ShareIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { approveBriefAction, updateBriefAction } from "@/server/actions/briefs";
import { AIGeneratedBadge, DraftBadge, HumanApprovedBadge } from "../shared/badges";
import { LocalDateTime } from "../shared/misc";
import { RichText, SourceChip } from "../shared/sources";

export interface BriefEditorProps {
  caseId: string;
  type: Exclude<BriefType, "CASE_SUMMARY">;
  brief: {
    id: string;
    /** Content version on screen; edits and approval apply only to this version. */
    version: number;
    title: string;
    status: "DRAFT" | "APPROVED";
    content: SectionsContent;
    createdAt: string;
    requestedBy: string | null;
    editedBy: string | null;
    editedAt: string | null;
    approvedBy: string | null;
    approvedAt: string | null;
    provider: string | null;
  };
  canEdit: boolean;
  canApprove: boolean;
  isLatest: boolean;
}

export function BriefEditor({ caseId, type, brief, canEdit, canApprove, isLatest }: BriefEditorProps) {
  const router = useRouter();
  // The clinician's unsaved edits and the version they started from. Kept when the
  // brief changes remotely (edit or approval), so typed text is never discarded silently.
  const [draft, setDraft] = useState<{ baseVersion: number; bodies: Record<string, string> } | null>(null);
  const editing = draft !== null;
  const conflict = draft !== null && draft.baseVersion !== brief.version;
  const [saving, startSaving] = useTransition();
  const [approving, startApproving] = useTransition();
  const approved = brief.status === "APPROVED";
  const approveLabel = type === "TUMOR_BOARD" ? "Approve & share" : "Approve handoff";

  function startEditing() {
    setDraft({ baseVersion: brief.version, bodies: Object.fromEntries(brief.content.sections.map((s) => [s.key, s.body])) });
  }

  function save() {
    if (!draft) return;
    startSaving(async () => {
      const result = await updateBriefAction(caseId, brief.id, {
        sections: Object.entries(draft.bodies).map(([key, body]) => ({ key, body })),
        // The version the edits are based on, not the latest one: the server refuses stale edits.
        expectedVersion: draft.baseVersion,
      });
      if (!result.ok) {
        toast.error(result.error); // the draft stays on screen
        return;
      }
      toast.success(approved ? "Saved. The brief returned to draft and needs approval again." : "Edits saved");
      setDraft(null);
      router.refresh();
    });
  }

  function approve() {
    startApproving(async () => {
      const result = await approveBriefAction(caseId, brief.id, { expectedVersion: brief.version });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(type === "TUMOR_BOARD" ? "Brief approved and shared with the care team" : "Handoff approved: it is now final");
      router.refresh();
    });
  }

  return (
    <article className="overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] print:border-0 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/30 px-5 py-3.5">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold">{brief.title}</h2>
            <AIGeneratedBadge />
            {approved ? <HumanApprovedBadge /> : <DraftBadge />}
          </div>
          <div className="text-xs text-muted-foreground">
            Generated <LocalDateTime date={brief.createdAt} />
            {brief.requestedBy ? ` for ${brief.requestedBy}` : ""}
            {brief.provider ? ` by ${brief.provider}` : ""}
            {brief.editedBy && brief.editedAt && (
              <>
                {" · "}edited by {brief.editedBy} <LocalDateTime date={brief.editedAt} />
              </>
            )}
            {approved && brief.approvedBy && brief.approvedAt && (
              <span className="font-medium text-approved">
                {" · "}approved by {brief.approvedBy} <LocalDateTime date={brief.approvedAt} />
              </span>
            )}
          </div>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setDraft(null)} disabled={saving}>
                <XIcon />
                {conflict ? "Discard my draft" : "Cancel"}
              </Button>
              <Button size="sm" onClick={save} disabled={saving || conflict}>
                {saving ? <Spinner /> : <SaveIcon />}
                Save edits
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <PrinterIcon />
                Print
              </Button>
              {canEdit && isLatest && (
                <Button variant="outline" size="sm" onClick={startEditing}>
                  <PencilIcon />
                  Edit
                </Button>
              )}
              {canApprove && isLatest && !approved && (
                <Button variant="approve" size="sm" onClick={approve} disabled={approving}>
                  {approving ? <Spinner /> : type === "TUMOR_BOARD" ? <ShareIcon /> : <CheckIcon />}
                  {approveLabel}
                </Button>
              )}
            </>
          )}
        </div>
      </header>

      {conflict && (
        <div role="alert" className="no-print flex items-start gap-2 border-b border-danger-border bg-danger-soft px-5 py-2.5 text-xs text-danger">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {brief.editedBy ?? "Someone"} saved a newer version of this brief while you were editing. Your text is still below and was not saved. Copy what you
            need, then discard your draft to load the latest version and edit again.
          </span>
        </div>
      )}
      {editing && !conflict && approved && (
        <div className="no-print flex items-start gap-2 border-b border-draft-border bg-draft-soft/60 px-5 py-2 text-xs text-draft">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
          This version is approved. Saving your edits returns it to draft for a new approval.
        </div>
      )}
      {!approved && (
        <div className="no-print flex items-start gap-2 border-b border-draft-border bg-draft-soft/60 px-5 py-2 text-xs text-draft">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
          AI-generated draft. Review every section against the sources and edit as needed. It is not final until a clinician approves it.
        </div>
      )}

      <div className="divide-y">
        {brief.content.sections.map((section) => (
          <section key={section.key} className="grid gap-2 px-5 py-4 md:grid-cols-[180px_minmax(0,1fr)]">
            <h3 className="pt-0.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{section.title}</h3>
            <div className="min-w-0 space-y-2">
              {draft ? (
                <Textarea
                  value={draft.bodies[section.key] ?? ""}
                  onChange={(event) => {
                    const body = event.target.value;
                    setDraft((previous) => previous && { ...previous, bodies: { ...previous.bodies, [section.key]: body } });
                  }}
                  className="min-h-20 text-[13px] leading-relaxed"
                />
              ) : (
                <RichText text={section.body} caseId={caseId} sources={section.sources} className="text-[13.5px]" />
              )}
              {!editing && section.sources.length > 0 && (
                <div className="no-print flex flex-wrap gap-1.5">
                  {section.sources.map((source, index) => (
                    <SourceChip key={`${source.kind}-${source.id}`} caseId={caseId} source={source} index={index + 1} />
                  ))}
                </div>
              )}
            </div>
          </section>
        ))}
      </div>

      <footer className="flex items-start gap-2 border-t bg-muted/30 px-5 py-3 text-xs text-muted-foreground">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>
          <span className="font-medium text-foreground/80">Limitations:</span> {brief.content.limitations} AI-generated content must be reviewed by a qualified healthcare professional.
        </span>
      </footer>
    </article>
  );
}
