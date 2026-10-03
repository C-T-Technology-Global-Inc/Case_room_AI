import { toIsoDate } from "@ccr/database";
import { cn } from "@ccr/ui/lib/utils";
import type { SourceRef } from "@ccr/types";
import { CheckSquareIcon, MessageSquareIcon, ScaleIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { FollowUpTasks } from "@/components/decisions/follow-up-tasks";
import { NewDecisionButton } from "@/components/decisions/new-decision-button";
import { ReviewActions, ReviseButton } from "@/components/decisions/review-actions";
import { ApprovalStatusBadge, DecisionStatusBadge } from "@/components/shared/badges";
import { EmptyState } from "@/components/shared/empty-state";
import { LocalDateTime, TimeAgo } from "@/components/shared/misc";
import { SourceList } from "@/components/shared/sources";
import { UserAvatar } from "@/components/shared/user-avatar";
import { TaskStatusToggle } from "@/components/tasks/task-status-toggle";
import { shortName } from "@/lib/activity";
import type { UserSummary } from "@/lib/dto";
import { loadCasePage } from "@/server/case-page";
import { can } from "@/server/authz/permissions";
import { prisma } from "@ccr/database";
import { listDecisions } from "@/server/services/decisions";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</div>
      {children}
    </div>
  );
}

export default async function DecisionsPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { user, caseId } = await loadCasePage(params);
  const [decisions, members, documents] = await Promise.all([
    listDecisions(user, caseId),
    prisma.caseRoomMember.findMany({
      where: { caseRoomId: caseId },
      include: { user: { select: { id: true, name: true, role: true, specialty: true, handle: true, title: true } } },
    }),
    prisma.clinicalDocument.findMany({ where: { caseRoomId: caseId }, select: { id: true, title: true, type: true, documentDate: true }, orderBy: { documentDate: "desc" } }),
  ]);
  const memberList: UserSummary[] = members.map((m) => m.user);
  const documentOptions = documents.map((d) => ({ id: d.id, title: d.title, type: d.type, date: toIsoDate(d.documentDate) }));
  const canReview = can(user, "decision.review");

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-6 py-6 lg:px-8">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Decisions</h2>
          <p className="text-[13px] text-muted-foreground">Proposed by clinicians, reviewed by the care team. A decision is final only when every requested reviewer approves.</p>
        </div>
        <NewDecisionButton />
      </div>

      {decisions.length === 0 && (
        <EmptyState icon={ScaleIcon} title="No decisions yet" description="Propose a decision from the header, or directly from a message in the discussion." />
      )}

      {decisions.map((decision) => {
        const approvedCount = decision.approvals.filter((a) => a.status === "APPROVED").length;
        const myApproval = decision.approvals.find((a) => a.user.id === user.id);
        const final = decision.status === "APPROVED" || decision.status === "REJECTED";
        const canActAsReviewer = canReview && myApproval && !final;
        const isProposer = decision.createdBy.id === user.id;
        const sources: SourceRef[] = decision.sources.map(({ document }) => ({
          kind: "document",
          id: document.id,
          label: document.title,
          date: toIsoDate(document.documentDate),
          documentType: document.type,
        }));
        return (
          <article
            key={decision.id}
            id={`decision-${decision.id}`}
            className={cn(
              "scroll-mt-24 overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]",
              decision.status === "APPROVED" && "border-approved-border",
              decision.status === "REJECTED" && "border-danger-border",
            )}
          >
            {decision.status === "APPROVED" && decision.finalizedAt && (
              <div className="flex items-center gap-2 border-b border-approved-border bg-approved-soft px-5 py-2 text-[12.5px] font-medium text-approved">
                <ShieldCheckIcon className="size-4" />
                Final human-approved decision · recorded <LocalDateTime date={decision.finalizedAt} /> after approval by all {decision.approvals.length} reviewers
              </div>
            )}
            <div className="space-y-5 px-5 py-4">
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      {decision.status === "APPROVED" ? "Decision" : "Proposed decision"} #{decision.number}
                    </span>
                    <DecisionStatusBadge status={decision.status} />
                  </div>
                  <h3 className="text-[17px] leading-snug font-semibold tracking-tight">{decision.title}</h3>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <UserAvatar user={decision.createdBy} size="xs" />
                    Proposed by {decision.createdBy.name}
                    {decision.createdBy.specialty ? ` (${decision.createdBy.specialty})` : ""} · <TimeAgo date={decision.createdAt} />
                  </div>
                </div>
                {isProposer && !final && (
                  <ReviseButton
                    caseId={caseId}
                    decisionId={decision.id}
                    revision={decision.revision}
                    initial={{
                      title: decision.title,
                      description: decision.description,
                      rationale: decision.rationale,
                      sourceDocumentIds: decision.sources.map((s) => s.document.id),
                      reviewerIds: decision.approvals.map((a) => a.user.id),
                    }}
                    members={memberList}
                    documents={documentOptions}
                    currentUserId={user.id}
                  />
                )}
              </header>

              <p className="text-[13.5px] leading-relaxed text-foreground/90">{decision.description}</p>

              <Section title="Rationale">
                <div className="rounded-lg border bg-background/60 px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-line">{decision.rationale}</div>
              </Section>

              {sources.length > 0 && <SourceList caseId={caseId} sources={sources} label="Sources" />}

              {decision.sourceMessage && (
                <Link href={`/cases/${caseId}/discussion#message-${decision.sourceMessage.id}`} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary hover:underline">
                  <MessageSquareIcon className="size-3.5" />
                  Created from discussion: “{decision.sourceMessage.content.slice(0, 90)}
                  {decision.sourceMessage.content.length > 90 ? "…" : ""}”
                </Link>
              )}

              <Section title={`Approvals · ${approvedCount} of ${decision.approvals.length}`}>
                <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-approved transition-all" style={{ width: `${(approvedCount / Math.max(1, decision.approvals.length)) * 100}%` }} />
                </div>
                <ul className="divide-y rounded-lg border">
                  {decision.approvals.map((approval) => (
                    <li key={approval.id} className="flex items-start gap-3 px-3.5 py-2.5">
                      <UserAvatar user={approval.user} size="sm" className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[13px] font-medium">{approval.user.name}</span>
                          <span className="text-xs text-muted-foreground">{approval.user.specialty}</span>
                          {approval.user.id === user.id && <span className="text-xs font-medium text-primary">(you)</span>}
                        </div>
                        {approval.comment && <p className="mt-1 text-[12.5px] leading-relaxed text-foreground/85">“{approval.comment}”</p>}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <ApprovalStatusBadge status={approval.status} />
                        {approval.respondedAt && (
                          <span className="text-[11px] text-muted-foreground">
                            <TimeAgo date={approval.respondedAt} />
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>

              {canActAsReviewer && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3.5 py-3">
                  <div className="text-[13px]">
                    <div className="font-medium text-amber-900">
                      {myApproval.status === "PENDING" ? "Your review is requested" : `You responded: ${myApproval.status.replace("_", " ").toLowerCase()}. You can update your review.`}
                    </div>
                    <div className="text-xs text-amber-800/80">Only human reviewers can approve. The AI cannot approve or reject decisions.</div>
                  </div>
                  <ReviewActions caseId={caseId} decisionId={decision.id} number={decision.number} revision={decision.revision} />
                </div>
              )}

              {decision.status === "APPROVED" && (
                <Section title="Follow-up tasks">
                  <div className="space-y-2">
                    {decision.tasks.length > 0 && (
                      <ul className="space-y-1">
                        {decision.tasks.map((task) => (
                          <li key={task.id} className="flex items-center gap-2.5 rounded-md px-1 py-1 text-[13px]">
                            <TaskStatusToggle taskId={task.id} status={task.status} disabled={!can(user, "task.manage")} />
                            <span className={cn(task.status === "DONE" && "text-muted-foreground line-through")}>{task.title}</span>
                            {task.assignedTo && <span className="text-xs text-muted-foreground">· {shortName(task.assignedTo.name)}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                    {can(user, "task.manage") && (
                      <div className="flex items-center gap-2">
                        <FollowUpTasks caseId={caseId} decisionId={decision.id} number={decision.number} members={memberList} />
                        <Link href={`/cases/${caseId}/tasks`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                          <CheckSquareIcon className="size-3.5" /> All case tasks
                        </Link>
                      </div>
                    )}
                  </div>
                </Section>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
