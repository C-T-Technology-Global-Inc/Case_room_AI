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

/** Output cap (tokens, including reasoning) when a request does not set `maxOutputTokens`. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 16_000;

export interface LLMUsage {
  /** Uncached input tokens (Anthropic reports cache reads and writes separately). */
  inputTokens?: number;
  /** Output tokens, including reasoning/thinking tokens (billed as output). */
  outputTokens?: number;
  cacheReadTokens?: number;
  /** Tokens written to the prompt cache (billed above the normal input price). */
  cacheWriteTokens?: number;
}

/** What a completed provider response used, whether or not its output was accepted. */
export interface ResponseBilling {
  /** Model that actually served the request. */
  model: string;
  usage: LLMUsage;
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
