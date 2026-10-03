"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { runAction } from "../action-result";
import { requireUser } from "../auth/session";
import {
  createDecision,
  createFollowUpTasks,
  reviewDecision,
  reviseDecision,
  suggestFollowUpTasks,
  type confirmTasksSchema,
  type DecisionInput,
  type ReviseInput,
  type reviewSchema,
} from "../services/decisions";

export async function createDecisionAction(caseRoomId: string, input: DecisionInput) {
  return runAction(async () => {
    const user = await requireUser();
    const decision = await createDecision(user, caseRoomId, input);
    revalidatePath(`/cases/${caseRoomId}`, "layout");
    revalidatePath("/dashboard");
    return { id: decision.id, number: decision.number };
  });
}

export async function reviewDecisionAction(caseRoomId: string, decisionId: string, input: z.input<typeof reviewSchema>) {
  return runAction(async () => {
    const user = await requireUser();
    const result = await reviewDecision(user, decisionId, input);
    revalidatePath(`/cases/${caseRoomId}`, "layout");
    revalidatePath("/dashboard");
    return result;
  });
}

export async function reviseDecisionAction(caseRoomId: string, decisionId: string, input: ReviseInput) {
  return runAction(async () => {
    const user = await requireUser();
    const result = await reviseDecision(user, decisionId, input);
    revalidatePath(`/cases/${caseRoomId}`, "layout");
    return result;
  });
}

export async function suggestFollowUpTasksAction(decisionId: string) {
  return runAction(async () => {
    const user = await requireUser();
    const { suggestions, provider } = await suggestFollowUpTasks(user, decisionId);
    return { suggestions, provider: provider.label, isDemo: provider.isDemo };
  });
}

export async function createFollowUpTasksAction(caseRoomId: string, decisionId: string, input: z.input<typeof confirmTasksSchema>) {
  return runAction(async () => {
    const user = await requireUser();
    await createFollowUpTasks(user, decisionId, input);
    revalidatePath(`/cases/${caseRoomId}`, "layout");
    revalidatePath("/tasks");
    return null;
  });
}
