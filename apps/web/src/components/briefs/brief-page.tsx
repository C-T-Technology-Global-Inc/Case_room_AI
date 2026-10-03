import { cn } from "@ccr/ui/lib/utils";
import type { BriefType } from "@ccr/types";
import { ClipboardListIcon, HistoryIcon, PresentationIcon } from "lucide-react";
import Link from "next/link";
import { shortName } from "@/lib/activity";
import type { SessionUser } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { listBriefs } from "@/server/services/briefs";
import { EmptyState } from "../shared/empty-state";
import { LocalDateTime } from "../shared/misc";
import { BriefEditor } from "./brief-editor";
import { GenerateBriefButton } from "./generate-brief-button";

const COPY = {
  TUMOR_BOARD: {
    heading: "Tumor board brief",
    description: "AI prepares the brief from the full case record; clinicians edit and approve it before it is shared with the board.",
    empty: "No tumor board brief yet",
    emptyDescription:
      "The AI assembles the case summary, diagnosis, history, imaging, pathology, labs, treatments, missing information, open questions and questions for the tumor board, all linked to sources.",
    generate: "Prepare tumor board",
    regenerate: "Generate new version",
    icon: PresentationIcon,
  },
  HANDOFF: {
    heading: "Patient handoff",
    description: "Shift handoff drafted by AI from the latest notes, results and open tasks. Final only after a clinician approves it.",
    empty: "No handoff yet",
    emptyDescription: "The AI drafts current condition, changes since the previous shift, pending items, risks and next actions, with sources.",
    generate: "Generate handoff",
    regenerate: "Generate new handoff",
    icon: ClipboardListIcon,
  },
} as const;

function providerLabel(provider: string | null): string | null {
  if (!provider) return null;
  if (provider === "demo") return "the offline demo engine";
  if (provider === "demo-seed") return "the demo seed";
  return provider === "anthropic" ? "Anthropic Claude" : provider === "openai" ? "OpenAI" : provider;
}

export async function BriefPage({ user, caseId, type, selectedId }: { user: SessionUser; caseId: string; type: Exclude<BriefType, "CASE_SUMMARY">; selectedId?: string }) {
  const copy = COPY[type];
  const briefs = await listBriefs(user, caseId, type);
  const latest = briefs[0];
  const selected = (selectedId && briefs.find((b) => b.id === selectedId)) || latest;
  const canGenerate = can(user, type === "TUMOR_BOARD" ? "brief.generate" : "handoff.generate");
  const canApprove = can(user, type === "TUMOR_BOARD" ? "brief.approve" : "handoff.approve");
  const base = `/cases/${caseId}/${type === "TUMOR_BOARD" ? "tumor-board" : "handoff"}`;

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-6 py-6 lg:px-8">
      <div className="no-print flex items-start justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <h2 className="text-base font-semibold">{copy.heading}</h2>
          <p className="text-[13px] text-muted-foreground">{copy.description}</p>
        </div>
        {canGenerate && latest && <GenerateBriefButton caseId={caseId} type={type} label={copy.regenerate} variant="ai-outline" />}
      </div>

      {!selected || selected.parsed?.kind !== "sections" ? (
        <EmptyState
          icon={copy.icon}
          title={copy.empty}
          description={copy.emptyDescription}
          action={canGenerate ? <GenerateBriefButton caseId={caseId} type={type} label={copy.generate} /> : undefined}
        />
      ) : (
        <div className="space-y-3">
          {briefs.length > 1 && (
            <div className="no-print flex flex-wrap items-center gap-1.5">
              <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                <HistoryIcon className="size-3.5" /> Versions
              </span>
              {briefs.map((brief) => (
                <Link
                  key={brief.id}
                  href={brief.id === latest?.id ? base : `${base}?brief=${brief.id}`}
                  scroll={false}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs hover:bg-accent",
                    brief.id === selected.id && "border-primary/40 bg-primary/5 text-primary",
                  )}
                >
                  <LocalDateTime date={brief.createdAt} />
                  <span className={cn("size-1.5 rounded-full", brief.status === "APPROVED" ? "bg-approved" : "bg-draft")} />
                  {brief.id === latest?.id && <span className="text-muted-foreground">latest</span>}
                </Link>
              ))}
            </div>
          )}
          <BriefEditor
            key={selected.id}
            caseId={caseId}
            type={type}
            isLatest={selected.id === latest?.id}
            canEdit={canGenerate}
            canApprove={canApprove}
            brief={{
              id: selected.id,
              version: selected.version,
              title: selected.title,
              status: selected.status,
              content: selected.parsed,
              createdAt: selected.createdAt.toISOString(),
              requestedBy: selected.requestedBy ? shortName(selected.requestedBy.name) : null,
              editedBy: selected.editedBy ? shortName(selected.editedBy.name) : null,
              editedAt: selected.editedAt?.toISOString() ?? null,
              approvedBy: selected.approvedBy ? shortName(selected.approvedBy.name) : null,
              approvedAt: selected.approvedAt?.toISOString() ?? null,
              provider: providerLabel(selected.aiProvider),
            }}
          />
        </div>
      )}
    </div>
  );
}
