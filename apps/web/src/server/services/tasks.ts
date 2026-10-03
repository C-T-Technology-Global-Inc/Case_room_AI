import "server-only";
import { prisma, type Prisma } from "@ccr/database";
import type { TaskStatus } from "@ccr/types";
import { TASK_PRIORITIES, TASK_STATUS_LABELS, TASK_STATUSES } from "@ccr/types";
import { z } from "zod";
import type { SessionUser } from "../auth/session";
import { accessibleCaseWhere, assertCaseAccess } from "../authz/case-access";
import { assertCan } from "../authz/permissions";
import { NotFoundError, ValidationError } from "../errors";
import { realtime } from "../realtime/bus";
import { recordAudit } from "./audit";
import { postSystemMessage, touchCaseRoom } from "./system-messages";

export const taskInputSchema = z.object({
  title: z.string().trim().min(3, "Task title is required").max(200),
  description: z.string().trim().max(2000).optional(),
  assigneeId: z.string().nullable(),
  priority: z.enum(TASK_PRIORITIES),
  dueDate: z.iso.date().nullable(),
  sourceMessageId: z.string().nullable().optional(),
});
export type TaskInput = z.input<typeof taskInputSchema>;

export const taskInclude = {
  assignedTo: { select: { id: true, name: true, specialty: true, role: true } },
  createdBy: { select: { id: true, name: true } },
  decision: { select: { id: true, number: true, title: true } },
  caseRoom: { select: { id: true, title: true, patient: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.TaskInclude;

export async function listCaseTasks(user: SessionUser, caseRoomId: string) {
  await assertCaseAccess(user, caseRoomId);
  return prisma.task.findMany({
    where: { caseRoomId },
    include: taskInclude,
    orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
  });
}

/** Tasks across all accessible cases, for the global Tasks page and dashboard. */
export async function listTasksForUser(user: SessionUser, scope: "mine" | "created" | "all" = "mine") {
  return prisma.task.findMany({
    where: {
      caseRoom: accessibleCaseWhere(user),
      ...(scope === "mine" ? { assignedToId: user.id } : scope === "created" ? { createdById: user.id } : {}),
    },
    include: taskInclude,
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
  });
}

export async function createTask(user: SessionUser, caseRoomId: string, raw: TaskInput) {
  assertCan(user, "task.manage");
  await assertCaseAccess(user, caseRoomId);
  const input = taskInputSchema.parse(raw);
  if (input.assigneeId) {
    const member = await prisma.caseRoomMember.findUnique({ where: { caseRoomId_userId: { caseRoomId, userId: input.assigneeId } } });
    if (!member) throw new ValidationError("The assignee must be on this case's care team.");
  }
  if (input.sourceMessageId) {
    const message = await prisma.message.findFirst({ where: { id: input.sourceMessageId, caseRoomId } });
    if (!message) throw new ValidationError("The linked message does not belong to this case.");
  }

  const task = await prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        caseRoomId,
        title: input.title,
        description: input.description || null,
        assignedToId: input.assigneeId,
        priority: input.priority,
        dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null,
        createdById: user.id,
        sourceMessageId: input.sourceMessageId ?? null,
      },
      include: { assignedTo: { select: { name: true } } },
    });
    await recordAudit(tx, {
      organizationId: user.organizationId,
      caseRoomId,
      userId: user.id,
      action: "task.created",
      resourceType: "Task",
      resourceId: task.id,
      metadata: { title: task.title, assignee: task.assignedTo?.name ?? null, fromMessage: Boolean(input.sourceMessageId) },
    });
    await postSystemMessage(tx, {
      caseRoomId,
      content: `${user.name} created task "${task.title}"${task.assignedTo ? ` for ${task.assignedTo.name}` : ""}.`,
      event: "task.created",
      refType: "task",
      refId: task.id,
    });
    await touchCaseRoom(tx, caseRoomId);
    return task;
  });
  await realtime.touch(caseRoomId, ["tasks", "messages", "audit"], user.id);
  return task;
}

export async function updateTaskStatus(user: SessionUser, taskId: string, status: TaskStatus) {
  assertCan(user, "task.manage");
  if (!TASK_STATUSES.includes(status)) throw new ValidationError("Unknown status");
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new NotFoundError("Task not found");
  await assertCaseAccess(user, task.caseRoomId);
  if (task.status === status) return task;

  await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: taskId },
      data: { status, completedAt: status === "DONE" ? new Date() : null },
    });
    await recordAudit(tx, {
      organizationId: user.organizationId,
      caseRoomId: task.caseRoomId,
      userId: user.id,
      action: status === "DONE" ? "task.completed" : "task.status_changed",
      resourceType: "Task",
      resourceId: taskId,
      metadata: { title: task.title, from: task.status, to: status },
    });
    if (status === "DONE") {
      await postSystemMessage(tx, {
        caseRoomId: task.caseRoomId,
        content: `${user.name} completed task "${task.title}".`,
        event: "task.completed",
        refType: "task",
        refId: taskId,
      });
    }
    await touchCaseRoom(tx, task.caseRoomId);
  });
  await realtime.touch(task.caseRoomId, ["tasks", "messages", "audit"], user.id);
  return { ...task, status, statusLabel: TASK_STATUS_LABELS[status] };
}
