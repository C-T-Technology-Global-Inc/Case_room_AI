import "server-only";
import { randomUUID } from "node:crypto";
import { toUserMessage } from "@ccr/ai";
import { prisma, type Prisma } from "@ccr/database";
import type { AIAnswerMetadata, AIErrorMetadata, UserMessageMetadata } from "@ccr/types";
import { parseMessageMetadata } from "@ccr/types";
import { z } from "zod";
import type { MessageDTO } from "@/lib/dto";
import { parseMentions } from "@/lib/mentions";
import type { SessionUser } from "../auth/session";
import { assertCaseAccess } from "../authz/case-access";
import { assertCan } from "../authz/permissions";
import { NotFoundError } from "../errors";
import { realtime } from "../realtime/bus";
import { buildCaseContext, getAIProvider } from "./ai";
import { finishAIRun, reserveAIRun } from "./ai-quota";
import { recordAudit } from "./audit";
import { touchCaseRoom } from "./system-messages";

export const ALLOWED_REACTIONS = ["👍", "✅", "👀", "❗", "🙏"] as const;

const messageInclude = {
  author: { select: { id: true, name: true, role: true, specialty: true, handle: true, title: true } },
  reactions: { include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.MessageInclude;

type MessageWithRelations = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export function toMessageDTO(message: MessageWithRelations): MessageDTO {
  const grouped = new Map<string, { userIds: string[]; names: string[] }>();
  for (const reaction of message.reactions) {
    const entry = grouped.get(reaction.emoji) ?? { userIds: [], names: [] };
    entry.userIds.push(reaction.user.id);
    entry.names.push(reaction.user.name);
    grouped.set(reaction.emoji, entry);
  }
  return {
    id: message.id,
    type: message.type,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    author: message.author,
    metadata: parseMessageMetadata(message.metadata),
    reactions: [...grouped.entries()].map(([emoji, entry]) => ({ emoji, count: entry.userIds.length, ...entry })),
  };
}

export async function listMessages(user: SessionUser, caseRoomId: string, limit = 150): Promise<MessageDTO[]> {
  await assertCaseAccess(user, caseRoomId);
  const messages = await prisma.message.findMany({
    where: { caseRoomId },
    include: messageInclude,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return messages.reverse().map(toMessageDTO);
}


export const postMessageSchema = z.object({
  content: z.string().trim().min(1, "Message is empty").max(8000, "Message is too long"),
});

/**
 * Post a discussion message. When the message mentions @AI, the returned
 * `aiQuestion` should be answered in the background (see answerInDiscussion).
 */
export async function postMessage(user: SessionUser, caseRoomId: string, rawContent: string) {
  assertCan(user, "message.post");
  await assertCaseAccess(user, caseRoomId);
  const { content } = postMessageSchema.parse({ content: rawContent });

  const members = await prisma.caseRoomMember.findMany({
    where: { caseRoomId },
    include: { user: { select: { id: true, handle: true } } },
  });
  const mentions = parseMentions(content, members.map((m) => m.user));
  const question = content.replace(/@ai\b/gi, "").replace(/\s+/g, " ").trim();
  const aiRequested = mentions.mentionsAI && question.length > 0;
  if (aiRequested) assertCan(user, "ai.ask");
  // The answer runs later (after the response); its budget is reserved now and closed by answerInDiscussion.
  const aiRun = aiRequested ? await reserveAIRun(user, { task: "case_question" }) : null;

  const metadata: UserMessageMetadata = { kind: "user", mentionedUserIds: mentions.userIds, mentionsAI: aiRequested };
  const message = await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: { caseRoomId, authorId: user.id, type: "USER", content, metadata: metadata as Prisma.InputJsonValue },
      include: messageInclude,
    });
    await recordAudit(tx, {
      organizationId: user.organizationId,
      caseRoomId,
      userId: user.id,
      action: aiRequested ? "ai.question_asked" : "message.posted",
      resourceType: "Message",
      resourceId: message.id,
      metadata: aiRequested ? { question: question.slice(0, 300) } : { mentions: mentions.userIds.length },
    });
    await touchCaseRoom(tx, caseRoomId);
    return message;
  }).catch(async (error: unknown) => {
    if (aiRun) await finishAIRun(aiRun.id, "RELEASED");
    throw error;
  });

  await realtime.publish({ type: "message.created", caseRoomId, messageId: message.id });
  return { message: toMessageDTO(message), aiQuestion: aiRequested ? question : null, aiRunId: aiRun?.id ?? null };
}

/** Answer an @AI question with sources, and post the answer to the discussion. */
export async function answerInDiscussion(input: {
  caseRoomId: string;
  organizationId: string;
  questionMessageId: string;
  question: string;
  requester: { id: string; name: string };
  /** Reservation made when the question was posted (see postMessage). */
  aiRunId: string;
}) {
  const { caseRoomId, question, requester } = input;
  const requestId = randomUUID();
  await realtime.publish({
    type: "ai.thinking",
    caseRoomId,
    requestId,
    requestedBy: requester.name,
    label: `Reviewing the case record to answer ${requester.name}`,
  });

  try {
    const ctx = await buildCaseContext(caseRoomId, requester.id);
    const result = await getAIProvider().answerCaseQuestion(ctx, { text: question, requester: ctx.requester });
    const metadata: AIAnswerMetadata = {
      kind: "ai_answer",
      question,
      questionMessageId: input.questionMessageId,
      requestedById: requester.id,
      sources: result.output.sources,
      confidence: result.output.confidence,
      limitations: result.output.limitations,
      provider: result.provider.id,
      model: result.model,
      droppedCitations: result.output.droppedCitations,
      latencyMs: result.latencyMs,
    };
    // The answer and its audit row commit together.
    const message = await prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: { caseRoomId, type: "AI", content: result.output.answer, metadata: metadata as Prisma.InputJsonValue },
      });
      await recordAudit(tx, {
        organizationId: input.organizationId,
        caseRoomId,
        userId: requester.id,
        actorType: "AI",
        action: "ai.answer_generated",
        resourceType: "Message",
        resourceId: message.id,
        metadata: {
          sources: result.output.sources.length,
          confidence: result.output.confidence,
          droppedCitations: result.output.droppedCitations,
          provider: result.provider.id,
          model: result.model,
        },
      });
      await touchCaseRoom(tx, caseRoomId);
      return message;
    });
    await finishAIRun(input.aiRunId, "SUCCEEDED");
    await realtime.publish({ type: "message.created", caseRoomId, messageId: message.id });
  } catch (error) {
    await finishAIRun(input.aiRunId, "FAILED", error);
    console.error("[ai] answer failed", error);
    const metadata: AIErrorMetadata = {
      kind: "ai_error",
      question,
      questionMessageId: input.questionMessageId,
      error: toUserMessage(error),
    };
    const message = await prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: { caseRoomId, type: "AI", content: toUserMessage(error), metadata: metadata as Prisma.InputJsonValue },
      });
      await recordAudit(tx, {
        organizationId: input.organizationId,
        caseRoomId,
        userId: requester.id,
        actorType: "AI",
        action: "ai.answer_failed",
        resourceType: "Message",
        resourceId: message.id,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
      await touchCaseRoom(tx, caseRoomId);
      return message;
    });
    await realtime.publish({ type: "message.created", caseRoomId, messageId: message.id });
  } finally {
    await realtime.publish({ type: "ai.done", caseRoomId, requestId });
    await realtime.touch(caseRoomId, ["audit"]);
  }
}

export async function toggleReaction(user: SessionUser, messageId: string, emoji: string) {
  if (!(ALLOWED_REACTIONS as readonly string[]).includes(emoji)) throw new NotFoundError("Unknown reaction");
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { caseRoomId: true } });
  if (!message) throw new NotFoundError("Message not found");
  await assertCaseAccess(user, message.caseRoomId);

  const existing = await prisma.messageReaction.findUnique({
    where: { messageId_userId_emoji: { messageId, userId: user.id, emoji } },
  });
  if (existing) await prisma.messageReaction.delete({ where: { id: existing.id } });
  else await prisma.messageReaction.create({ data: { messageId, userId: user.id, emoji } });
  await realtime.publish({ type: "message.updated", caseRoomId: message.caseRoomId, messageId });
}
