"use client";

import { Button } from "@ccr/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@ccr/ui/components/dropdown-menu";
import { TASK_STATUS_LABELS, TASK_STATUSES, type TaskStatus } from "@ccr/types";
import { ArrowRightIcon, ListPlusIcon, MoreHorizontalIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { updateTaskStatusAction } from "@/server/actions/tasks";
import { useCaseActions } from "../case/case-actions";

export function NewTaskButton() {
  const { openCreateTask, permissions } = useCaseActions();
  if (!permissions.manageTasks) return null;
  return (
    <Button size="sm" onClick={() => openCreateTask()}>
      <ListPlusIcon />
      Add task
    </Button>
  );
}

export function MoveTaskMenu({ taskId, status }: { taskId: string; status: TaskStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" disabled={pending} aria-label="Move task">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Move to</DropdownMenuLabel>
        {TASK_STATUSES.filter((s) => s !== status).map((next) => (
          <DropdownMenuItem
            key={next}
            onSelect={() =>
              startTransition(async () => {
                const result = await updateTaskStatusAction(taskId, next);
                if (!result.ok) toast.error(result.error);
                else {
                  toast.success(`Moved to ${TASK_STATUS_LABELS[next]}`);
                  router.refresh();
                }
              })
            }
          >
            <ArrowRightIcon />
            {TASK_STATUS_LABELS[next]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
