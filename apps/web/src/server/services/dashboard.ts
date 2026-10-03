import "server-only";
import { prisma } from "@ccr/database";
import type { SessionUser } from "../auth/session";
import { accessibleCaseWhere } from "../authz/case-access";
import { can } from "../authz/permissions";
import { listCases } from "./cases";
import { listTasksForUser } from "./tasks";

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export async function getDashboard(user: SessionUser) {
  const today = startOfTodayUtc();
  const inAWeek = new Date(today.getTime() + 7 * 86_400_000);

  const [cases, pendingApprovals, myTasks, activity] = await Promise.all([
    listCases(user),
    prisma.approval.findMany({
      where: {
        userId: user.id,
        status: "PENDING",
        decision: { status: { in: ["PROPOSED", "UNDER_REVIEW"] }, caseRoom: accessibleCaseWhere(user) },
      },
      include: {
        decision: {
          include: {
            createdBy: { select: { name: true, specialty: true } },
            approvals: { select: { status: true } },
            caseRoom: { select: { id: true, title: true, patient: { select: { firstName: true, lastName: true } } } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    listTasksForUser(user, "mine"),
    prisma.auditEvent.findMany({
      where: {
        organizationId: user.organizationId,
        action: { notIn: ["auth.signed_in", "message.posted"] },
        ...(can(user, "case.viewAll") ? {} : { caseRoom: { members: { some: { userId: user.id } } } }),
      },
      include: {
        user: { select: { name: true } },
        caseRoom: { select: { id: true, patient: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 14,
    }),
  ]);

  const openTasks = myTasks.filter((task) => task.status !== "DONE");
  const overdue = openTasks.filter((task) => task.dueDate && task.dueDate < today);
  const upcoming = openTasks.filter((task) => task.dueDate && task.dueDate >= today && task.dueDate <= inAWeek);
  const activeCases = cases.filter((room) => room.status !== "CLOSED");

  return {
    activeCases,
    pendingApprovals,
    tasks: { open: openTasks, overdue, upcoming },
    activity,
    stats: {
      activeCases: activeCases.length,
      pendingApprovals: pendingApprovals.length,
      openTasks: openTasks.length,
      overdueTasks: overdue.length,
    },
  };
}
