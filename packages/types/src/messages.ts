import { z } from "zod";
import { sourceRefSchema } from "./sources";

/** Metadata stored in Message.metadata, discriminated by `kind`. */

export const AI_CONFIDENCE_LEVELS = ["high", "moderate", "low", "insufficient"] as const;
export type AIConfidence = (typeof AI_CONFIDENCE_LEVELS)[number];

export const userMessageMetadataSchema = z.object({
  kind: z.literal("user"),
  mentionedUserIds: z.array(z.string()),
  mentionsAI: z.boolean(),
});

export const aiAnswerMetadataSchema = z.object({
  kind: z.literal("ai_answer"),
  question: z.string(),
  questionMessageId: z.string().nullable(),
  requestedById: z.string().nullable(),
  sources: z.array(sourceRefSchema),
  confidence: z.enum(AI_CONFIDENCE_LEVELS),
  limitations: z.string(),
  provider: z.string(),
  model: z.string(),
  /** Citations returned by the model that did not match any real record (dropped). */
  droppedCitations: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative().optional(),
});

export const aiErrorMetadataSchema = z.object({
  kind: z.literal("ai_error"),
  question: z.string(),
  questionMessageId: z.string().nullable(),
  error: z.string(),
});

export const systemMessageMetadataSchema = z.object({
  kind: z.literal("system"),
  event: z.string(),
  refType: z.string().nullable().optional(),
  refId: z.string().nullable().optional(),
});

export const messageMetadataSchema = z.discriminatedUnion("kind", [
  userMessageMetadataSchema,
  aiAnswerMetadataSchema,
  aiErrorMetadataSchema,
  systemMessageMetadataSchema,
]);

export type UserMessageMetadata = z.infer<typeof userMessageMetadataSchema>;
export type AIAnswerMetadata = z.infer<typeof aiAnswerMetadataSchema>;
export type AIErrorMetadata = z.infer<typeof aiErrorMetadataSchema>;
export type SystemMessageMetadata = z.infer<typeof systemMessageMetadataSchema>;
export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

export function parseMessageMetadata(value: unknown): MessageMetadata | null {
  const parsed = messageMetadataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
