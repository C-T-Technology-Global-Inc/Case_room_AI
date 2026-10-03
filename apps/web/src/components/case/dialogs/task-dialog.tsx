"use client";

import { Button } from "@ccr/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ccr/ui/components/dialog";
import { Input } from "@ccr/ui/components/input";
import { Label } from "@ccr/ui/components/label";
import { Spinner } from "@ccr/ui/components/misc";
import { NativeSelect } from "@ccr/ui/components/native-select";
import { Textarea } from "@ccr/ui/components/textarea";
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, type TaskPriority } from "@ccr/types";
import { CheckSquareIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { UserSummary } from "@/lib/dto";
import { createTaskAction } from "@/server/actions/tasks";

export interface TaskPrefill {
  title?: string;
  description?: string;
  sourceMessageId?: string | null;
  assigneeId?: string | null;
}

function inDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function TaskDialog({
  caseId,
  open,
  onOpenChange,
  prefill,
  members,
}: {
  caseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: TaskPrefill;
  members: UserSummary[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(prefill?.title ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [assigneeId, setAssigneeId] = useState(prefill?.assigneeId ?? "");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [dueDate, setDueDate] = useState(inDays(2));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createTaskAction(caseId, {
        title,
        description: description || undefined,
        assigneeId: assigneeId || null,
        priority,
        dueDate: dueDate || null,
        sourceMessageId: prefill?.sourceMessageId ?? null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Task created");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(value) => (pending ? undefined : onOpenChange(value))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckSquareIcon className="size-4 text-primary" />
            New task
          </DialogTitle>
          <DialogDescription>{prefill?.sourceMessageId ? "Created from a discussion message; the message will be linked." : "Assign a follow-up to a member of the care team."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="task-title">Title</Label>
            <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Order molecular testing" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-description">Details</Label>
            <Textarea id="task-description" value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-16" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="task-assignee">Owner</Label>
              <NativeSelect id="task-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-priority">Priority</Label>
              <NativeSelect id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
                {TASK_PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {TASK_PRIORITY_LABELS[value]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-due">Due date</Label>
              <Input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          {error && <p className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Spinner />}
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
