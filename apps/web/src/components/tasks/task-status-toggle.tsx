"use client";

import { cn } from "@ccr/ui/lib/utils";
import type { TaskStatus } from "@ccr/types";
import { CheckIcon } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { updateTaskStatusAction } from "@/server/actions/tasks";

/** Round checkbox that cycles TODO → IN_PROGRESS → DONE (click) and DONE → TODO. */
export function TaskStatusToggle({ taskId, status, disabled }: { taskId: string; status: TaskStatus; disabled?: boolean }) {
  const [optimistic, setOptimistic] = useOptimistic(status);
  const [pending, startTransition] = useTransition();
  const next: TaskStatus = optimistic === "TODO" ? "IN_PROGRESS" : optimistic === "IN_PROGRESS" ? "DONE" : "TODO";
  const label = optimistic === "TODO" ? "Start task" : optimistic === "IN_PROGRESS" ? "Mark done" : "Reopen task";

  return (
    <button
      type="button"
      disabled={disabled || pending}
      title={label}
      aria-label={label}
      onClick={() =>
        startTransition(async () => {
          setOptimistic(next);
          const result = await updateTaskStatusAction(taskId, next);
          if (!result.ok) toast.error(result.error);
          else if (next === "DONE") toast.success("Task completed");
        })
      }
      className={cn(
        "mt-0.5 flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-full border-[1.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        optimistic === "DONE" && "border-approved bg-approved text-white",
        optimistic === "IN_PROGRESS" && "border-primary bg-[conic-gradient(var(--primary)_0_50%,transparent_50%_100%)]",
        optimistic === "TODO" && "border-muted-foreground/40 hover:border-primary",
      )}
    >
      {optimistic === "DONE" && <CheckIcon className="size-3" strokeWidth={3} />}
    </button>
  );
}
