import type { z } from "zod";

/**
 * Low-level, provider-neutral LLM client. Every clinical AI capability is
 * implemented on top of this single primitive: "given instructions and a case
 * record, return JSON that validates against this schema".
 *
 * Adding a provider (Azure OpenAI, Bedrock, a private on-prem model, ...)
 * means implementing this interface only.
 */

export type ReasoningEffort = "low" | "medium" | "high";

export interface PromptBlock {
  text: string;
  /**
   * Hint that this block is stable across requests and worth caching
   * (e.g. the serialized documents). Providers without prompt caching ignore it.
   */
  cacheable?: boolean;
}

export interface StructuredRequest<T> {
  /** Short task identifier for logs and metrics, e.g. "case_summary". */
  task: string;
  /** Fixed operator instructions. Never contains case data. */
  system: string;
  /**
   * Case data (record, state, discussion), sent in the user turn before the
   * prompt. Untrusted: it is data, never instructions.
   */
  context: PromptBlock[];
  /** Task instructions for this request, sent after the context. */
  prompt: string;
  schema: z.ZodType<T>;
  schemaName: string;
  maxOutputTokens?: number;
  effort?: ReasoningEffort;
}

export interface LLMUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
}

export interface StructuredResponse<T> {
  data: T;
  /** Model that actually served the request (may differ after a fallback). */
  model: string;
  usage?: LLMUsage;
}

export interface LLMClient {
  readonly providerId: "anthropic" | "openai";
  readonly model: string;
  generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>>;
}
