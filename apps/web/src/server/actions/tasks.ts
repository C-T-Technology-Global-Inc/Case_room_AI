"use server";

import type { TaskStatus } from "@ccr/types";
import { revalidatePath } from "next/cache";
import { runAction } from "../action-result";
import { requireUser } from "../auth/session";
import { createTask, updateTaskStatus, type TaskInput } from "../services/tasks";

export async function createTaskAction(caseRoomId: string, input: TaskInput) {
  return runAction(async () => {
    const user = await requireUser();
    const task = await createTask(user, caseRoomId, input);
    revalidatePath(`/cases/${caseRoomId}`, "layout");
    revalidatePath("/tasks");
    return { id: task.id };
  });
}

export async function updateTaskStatusAction(taskId: string, status: TaskStatus) {
  return runAction(async () => {
    const user = await requireUser();
    const task = await updateTaskStatus(user, taskId, status);
    revalidatePath(`/cases/${task.caseRoomId}`, "layout");
    revalidatePath("/tasks");
    revalidatePath("/dashboard");
    return null;
  });
}
