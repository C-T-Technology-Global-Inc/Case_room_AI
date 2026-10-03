import { cn } from "@ccr/ui/lib/utils";
import { CheckSquareIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { TaskRow } from "@/components/tasks/task-row";
import { daysFromToday } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { listTasksForUser } from "@/server/services/tasks";

export const metadata: Metadata = { title: "Tasks" };

const SCOPES = [
  { key: "mine", label: "Assigned to me" },
  { key: "created", label: "Created by me" },
  { key: "all", label: "All in my cases" },
] as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const user = await requireUser();
  const { scope: rawScope } = await searchParams;
  const scope = SCOPES.find((s) => s.key === rawScope)?.key ?? "mine";
  const tasks = await listTasksForUser(user, scope);
  const open = tasks.filter((t) => t.status !== "DONE");
  const done = tasks.filter((t) => t.status === "DONE").slice(0, 10);

  const groups = [
    { key: "overdue", title: "Overdue", tone: "text-red-600", items: open.filter((t) => t.dueDate && daysFromToday(t.dueDate) < 0) },
    { key: "today", title: "Due today", tone: "text-amber-700", items: open.filter((t) => t.dueDate && daysFromToday(t.dueDate) === 0) },
    { key: "week", title: "Next 7 days", tone: "text-foreground", items: open.filter((t) => t.dueDate && daysFromToday(t.dueDate) > 0 && daysFromToday(t.dueDate) <= 7) },
    { key: "later", title: "Later or no due date", tone: "text-foreground", items: open.filter((t) => !t.dueDate || daysFromToday(t.dueDate) > 7) },
    { key: "done", title: "Recently completed", tone: "text-muted-foreground", items: done },
  ];
  const canManage = can(user, "task.manage");

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader title="Tasks" description="Follow-ups across your care teams. Complete a task by clicking its circle; click again to reopen." />
      <div className="flex gap-1.5">
        {SCOPES.map((s) => (
          <Link
            key={s.key}
            href={s.key === "mine" ? "/tasks" : `/tasks?scope=${s.key}`}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium", scope === s.key ? "border-primary bg-primary/10 text-primary" : "bg-card text-muted-foreground hover:text-foreground")}
          >
            {s.label}
          </Link>
        ))}
      </div>
      {tasks.length === 0 ? (
        <EmptyState icon={CheckSquareIcon} title="No tasks" description="Tasks created in your case rooms will appear here." />
      ) : (
        <div className="space-y-6">
          {groups
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <section key={group.key} className="rounded-xl border bg-card">
                <header className={cn("flex items-center gap-2 border-b px-4 py-2.5 text-[13px] font-semibold", group.tone)}>
                  {group.title}
                  <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">{group.items.length}</span>
                </header>
                <div className="p-2">
                  {group.items.map((task) => (
                    <TaskRow key={task.id} task={task} canManage={canManage} />
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}
    </PageContainer>
  );
}
