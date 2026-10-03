import { prisma } from "@ccr/database";
import { parseCaseMemory } from "@ccr/types";
import { CheckSquareIcon, ScaleIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { MemoryCard } from "@/components/overview/memory-card";
import { GenerateSummaryButton } from "@/components/overview/summary-actions";
import { SummaryCard } from "@/components/overview/summary-card";
import { DecisionStatusBadge } from "@/components/shared/badges";
import { EmptyState } from "@/components/shared/empty-state";
import { TaskRow } from "@/components/tasks/task-row";
import { shortName } from "@/lib/activity";
import { loadCasePage } from "@/server/case-page";
import { can } from "@/server/authz/permissions";
import { getLatestSummary } from "@/server/services/briefs";

export default async function CaseOverviewPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { user, caseId } = await loadCasePage(params);

  const [summary, memoryRow, decisions, tasks, documentCount] = await Promise.all([
    getLatestSummary(user, caseId),
    prisma.caseMemory.findUnique({ where: { caseRoomId: caseId } }),
    prisma.decision.findMany({
      where: { caseRoomId: caseId, status: { in: ["PROPOSED", "UNDER_REVIEW"] } },
      include: { approvals: { select: { status: true } }, createdBy: { select: { name: true } } },
      orderBy: { number: "desc" },
    }),
    prisma.task.findMany({
      where: { caseRoomId: caseId, status: { not: "DONE" } },
      include: { assignedTo: { select: { id: true, name: true } } },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }],
      take: 6,
    }),
    prisma.clinicalDocument.count({ where: { caseRoomId: caseId } }),
  ]);
  const memory = memoryRow ? parseCaseMemory(memoryRow.data) : null;
  const canGenerate = can(user, "brief.generate");

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-6 lg:px-8">
      {summary ? (
        <SummaryCard
          caseId={caseId}
          briefId={summary.id}
          version={summary.version}
          summary={summary.summary}
          status={summary.status}
          createdAt={summary.createdAt}
          requestedBy={summary.requestedBy ? shortName(summary.requestedBy.name) : null}
          approvedBy={summary.approvedBy ? shortName(summary.approvedBy.name) : null}
          approvedAt={summary.approvedAt}
          provider={summary.aiProvider === "demo" ? "the offline demo engine" : summary.aiProvider === "demo-seed" ? "the demo seed" : summary.aiProvider}
          model={summary.aiModel === "seed" ? null : summary.aiModel}
          canGenerate={canGenerate}
          canApprove={can(user, "brief.approve")}
        />
      ) : (
        <EmptyState
          icon={SparklesIcon}
          title="No AI case summary yet"
          description={
            documentCount === 0
              ? "Upload clinical documents first. The AI summarizes only what is in the case record, with sources."
              : `The AI will summarize ${documentCount} documents, the timeline, decisions and discussion, and flag missing information.`
          }
          action={canGenerate && documentCount > 0 ? <GenerateSummaryButton caseId={caseId} /> : undefined}
        />
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border bg-card">
          <header className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ScaleIcon className="size-4 text-amber-600" /> Pending decisions
            </h2>
            <Link href={`/cases/${caseId}/decisions`} className="text-xs font-medium text-primary hover:underline">
              Open decisions
            </Link>
          </header>
          <div className="space-y-2 p-3">
            {decisions.length === 0 && <p className="px-1 py-4 text-center text-[13px] text-muted-foreground">No decisions awaiting review.</p>}
            {decisions.map((decision) => {
              const approved = decision.approvals.filter((a) => a.status === "APPROVED").length;
              return (
                <Link key={decision.id} href={`/cases/${caseId}/decisions#decision-${decision.id}`} className="block rounded-lg border px-3 py-2.5 hover:bg-accent">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">Decision #{decision.number}</span>
                    <DecisionStatusBadge status={decision.status} />
                  </div>
                  <div className="mt-1 text-[13px] font-medium">{decision.title}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-approved" style={{ width: `${(approved / Math.max(1, decision.approvals.length)) * 100}%` }} />
                    </div>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {approved}/{decision.approvals.length} approved
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border bg-card">
          <header className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <CheckSquareIcon className="size-4 text-emerald-600" /> Pending tasks
            </h2>
            <Link href={`/cases/${caseId}/tasks`} className="text-xs font-medium text-primary hover:underline">
              Open tasks
            </Link>
          </header>
          <div className="p-2">
            {tasks.length === 0 && <p className="px-1 py-4 text-center text-[13px] text-muted-foreground">No open tasks.</p>}
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} showCase={false} canManage={can(user, "task.manage")} />
            ))}
          </div>
        </section>
      </div>

      {memory && memoryRow && <MemoryCard caseId={caseId} memory={memory} updatedAt={memoryRow.updatedAt} version={memoryRow.version} />}
    </div>
  );
}
