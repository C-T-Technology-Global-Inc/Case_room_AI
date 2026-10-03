"use server";

import { after } from "next/server";
import { runAction } from "../action-result";
import { requireUser } from "../auth/session";
import { answerInDiscussion, postMessage, toggleReaction } from "../services/messages";

/** Post to the case discussion. @AI questions are answered after the response is sent. */
export async function postMessageAction(caseRoomId: string, content: string) {
  return runAction(async () => {
    const user = await requireUser();
    const { message, aiQuestion, aiRunId } = await postMessage(user, caseRoomId, content);
    if (aiQuestion && aiRunId) {
      after(() =>
        answerInDiscussion({
          caseRoomId,
          organizationId: user.organizationId,
          questionMessageId: message.id,
          question: aiQuestion,
          requester: { id: user.id, name: user.name },
          aiRunId,
        }),
      );
    }
    return message;
  });
}

export async function toggleReactionAction(messageId: string, emoji: string) {
  return runAction(async () => {
    const user = await requireUser();
    await toggleReaction(user, messageId, emoji);
    return null;
  });
}
