import { cn } from "@ccr/ui/lib/utils";
import { TASK_STATUS_LABELS, TASK_STATUSES, type TaskStatus } from "@ccr/types";
import { MessageSquareIcon, ScaleIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { TaskPriorityBadge } from "@/components/shared/badges";
import { UserAvatar } from "@/components/shared/user-avatar";
import { MoveTaskMenu, NewTaskButton } from "@/components/tasks/task-board-actions";
import { DueChip } from "@/components/tasks/task-row";
import { TaskStatusToggle } from "@/components/tasks/task-status-toggle";
import { shortName } from "@/lib/activity";
import { can } from "@/server/authz/permissions";
import { loadCasePage } from "@/server/case-page";
import { listCaseTasks } from "@/server/services/tasks";

const COLUMN_STYLE: Record<TaskStatus, string> = {
  TODO: "bg-slate-400",
  IN_PROGRESS: "bg-primary",
  DONE: "bg-approved",
};

export default async function CaseTasksPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { user, caseId } = await loadCasePage(params);
  const tasks = await listCaseTasks(user, caseId);
  const canManage = can(user, "task.manage");

  return (
    <div className="space-y-5 px-6 py-6 lg:px-8">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Tasks</h2>
          <p className="text-[13px] text-muted-foreground">Follow-ups for the care team. Tasks can be created from discussion messages or suggested by AI after a decision is approved.</p>
        </div>
        <NewTaskButton />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {TASK_STATUSES.map((status) => {
          const column = tasks.filter((task) => task.status === status);
          return (
            <section key={status} className="flex min-h-40 flex-col rounded-xl border bg-muted/30">
              <header className="flex items-center justify-between px-3.5 py-2.5">
                <div className="flex items-center gap-2 text-[13px] font-semibold">
                  <span className={cn("size-2 rounded-full", COLUMN_STYLE[status])} />
                  {TASK_STATUS_LABELS[status]}
                  <span className="rounded-full bg-card px-1.5 text-[11px] font-medium text-muted-foreground tabular-nums">{column.length}</span>
                </div>
              </header>
              <div className="flex-1 space-y-2 px-2.5 pb-2.5">
                {column.length === 0 && <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">No tasks</p>}
                {column.map((task) => (
                  <div key={task.id} id={`task-${task.id}`} className="scroll-mt-24 rounded-lg border bg-card p-3 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] target:ring-2 target:ring-primary/40">
                    <div className="flex items-start gap-2.5">
                      <TaskStatusToggle taskId={task.id} status={task.status} disabled={!canManage} />
                      <div className="min-w-0 flex-1">
                        <div className={cn("text-[13px] leading-snug font-medium", task.status === "DONE" && "text-muted-foreground line-through")}>{task.title}</div>
                        {task.description && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{task.description}</p>}
                      </div>
                      {canManage && <MoveTaskMenu taskId={task.id} status={task.status} />}
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 pl-7">
                      <TaskPriorityBadge priority={task.priority} />
                      <DueChip dueDate={task.dueDate} done={task.status === "DONE"} />
                      {task.createdByAI && (
                        <span className="inline-flex items-center gap-0.5 text-[11px] text-ai">
                          <SparklesIcon className="size-3" />
                          AI-suggested
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 pl-7">
                      <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
                        {task.assignedTo ? (
                          <>
                            <UserAvatar user={task.assignedTo} size="xs" />
                            <span className="truncate">{shortName(task.assignedTo.name)}</span>
                          </>
                        ) : (
                          <span>Unassigned</span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-[11px]">
                        {task.decision && (
                          <Link href={`/cases/${caseId}/decisions#decision-${task.decision.id}`} className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-primary">
                            <ScaleIcon className="size-3" />#{task.decision.number}
                          </Link>
                        )}
                        {task.sourceMessageId && (
                          <Link href={`/cases/${caseId}/discussion#message-${task.sourceMessageId}`} className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-primary" title="Created from discussion">
                            <MessageSquareIcon className="size-3" />
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
