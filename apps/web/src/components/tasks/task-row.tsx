import { cn } from "@ccr/ui/lib/utils";
import type { TaskPriority, TaskStatus } from "@ccr/types";
import { SparklesIcon } from "lucide-react";
import Link from "next/link";
import { dueLabel, formatShortDate } from "@/lib/format";
import { TaskPriorityBadge } from "../shared/badges";
import { UserAvatar } from "../shared/user-avatar";
import { TaskStatusToggle } from "./task-status-toggle";

export interface TaskRowData {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  createdByAI: boolean;
  assignedTo: { id: string; name: string } | null;
  caseRoom?: { id: string; patient: { firstName: string; lastName: string } } | null;
}

export function DueChip({ dueDate, done }: { dueDate: Date | string | null; done?: boolean }) {
  const due = dueLabel(dueDate);
  if (!due || !dueDate) return null;
  if (done) return <span className="text-[11px] whitespace-nowrap text-muted-foreground">Due {formatShortDate(dueDate)}</span>;
  return (
    <span
      className={cn(
        "whitespace-nowrap text-[11px] font-medium",
        done ? "text-muted-foreground" : due.tone === "overdue" ? "text-red-600" : due.tone === "today" ? "text-amber-700" : "text-muted-foreground",
      )}
    >
      {due.text}
    </span>
  );
}

/** Compact task row with an inline status toggle (dashboard, tasks page). */
export function TaskRow({ task, showCase = true, canManage = true }: { task: TaskRowData; showCase?: boolean; canManage?: boolean }) {
  const done = task.status === "DONE";
  return (
    <div className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-accent/60">
      <TaskStatusToggle taskId={task.id} status={task.status} disabled={!canManage} />
      <div className="min-w-0 flex-1">
        <div className={cn("text-[13px] leading-snug font-medium", done && "text-muted-foreground line-through")}>{task.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <TaskPriorityBadge priority={task.priority} />
          <DueChip dueDate={task.dueDate} done={done} />
          {task.createdByAI && (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-ai">
              <SparklesIcon className="size-3" /> AI-suggested
            </span>
          )}
          {showCase && task.caseRoom && (
            <Link href={`/cases/${task.caseRoom.id}/tasks#task-${task.id}`} className="truncate text-[11px] text-muted-foreground hover:text-primary hover:underline">
              {task.caseRoom.patient.firstName} {task.caseRoom.patient.lastName}
            </Link>
          )}
        </div>
      </div>
      {task.assignedTo && <UserAvatar user={task.assignedTo} size="sm" />}
    </div>
  );
}
