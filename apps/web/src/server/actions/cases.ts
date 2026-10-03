"use server";

import type { CaseStatus } from "@ccr/types";
import { revalidatePath } from "next/cache";
import { runAction } from "../action-result";
import { requireUser } from "../auth/session";
import { addCaseMembers, createCase, updateCaseStatus, type CreateCaseInput } from "../services/cases";
import { addTimelineEvent, regenerateTimeline, type timelineEventSchema } from "../services/timeline";
import type { z } from "zod";

export async function createCaseAction(input: CreateCaseInput) {
  return runAction(async () => {
    const user = await requireUser();
    const room = await createCase(user, input);
    revalidatePath("/cases");
    revalidatePath("/dashboard");
    return { id: room.id };
  });
}

export async function updateCaseStatusAction(caseRoomId: string, status: CaseStatus) {
  return runAction(async () => {
    const user = await requireUser();
    await updateCaseStatus(user, caseRoomId, status);
    revalidatePath(`/cases/${caseRoomId}`, "layout");
    return null;
  });
}

export async function addCaseMembersAction(caseRoomId: string, userIds: string[]) {
  return runAction(async () => {
    const user = await requireUser();
    const added = await addCaseMembers(user, caseRoomId, userIds);
    revalidatePath(`/cases/${caseRoomId}`, "layout");
    return { added: added.length };
  });
}

export async function addTimelineEventAction(caseRoomId: string, input: z.input<typeof timelineEventSchema>) {
  return runAction(async () => {
    const user = await requireUser();
    await addTimelineEvent(user, caseRoomId, input);
    revalidatePath(`/cases/${caseRoomId}`, "layout");
    return null;
  });
}

export async function regenerateTimelineAction(caseRoomId: string) {
  return runAction(async () => {
    const user = await requireUser();
    const events = await regenerateTimeline(user, caseRoomId);
    revalidatePath(`/cases/${caseRoomId}`, "layout");
    return { events };
  });
}
