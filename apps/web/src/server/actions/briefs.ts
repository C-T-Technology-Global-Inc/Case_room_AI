"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { runAction } from "../action-result";
import { requireUser } from "../auth/session";
import {
  approveBrief,
  generateCaseSummary,
  generateHandoff,
  generateTumorBoardBrief,
  updateBriefSections,
  type approveBriefSchema,
  type updateSectionsSchema,
} from "../services/briefs";

export async function generateSummaryAction(caseRoomId: string) {
  return runAction(async () => {
    const user = await requireUser();
    const brief = await generateCaseSummary(user, caseRoomId);
    revalidatePath(`/cases/${caseRoomId}`, "layout");
    return { id: brief.id };
  });
}

export async function generateTumorBoardAction(caseRoomId: string) {
  return runAction(async () => {
    const user = await requireUser();
    const brief = await generateTumorBoardBrief(user, caseRoomId);
    revalidatePath(`/cases/${caseRoomId}`, "layout");
    return { id: brief.id };
  });
}

export async function generateHandoffAction(caseRoomId: string) {
  return runAction(async () => {
    const user = await requireUser();
    const brief = await generateHandoff(user, caseRoomId);
    revalidatePath(`/cases/${caseRoomId}`, "layout");
    return { id: brief.id };
  });
}

export async function updateBriefAction(caseRoomId: string, briefId: string, input: z.input<typeof updateSectionsSchema>) {
  return runAction(async () => {
    const user = await requireUser();
    await updateBriefSections(user, briefId, input);
    revalidatePath(`/cases/${caseRoomId}`, "layout");
    return null;
  });
}

export async function approveBriefAction(caseRoomId: string, briefId: string, input: z.input<typeof approveBriefSchema>) {
  return runAction(async () => {
    const user = await requireUser();
    await approveBrief(user, briefId, input);
    revalidatePath(`/cases/${caseRoomId}`, "layout");
    return null;
  });
}
