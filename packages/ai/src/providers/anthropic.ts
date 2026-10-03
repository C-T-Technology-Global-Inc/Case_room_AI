import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AIConfigurationError, AIOutputError, AIProviderError, AIRefusalError } from "../errors";
import type {
  LLMClient,
  ReasoningEffort,
  StructuredRequest,
  StructuredResponse,
} from "./llm-client";
import { parseStructuredJson } from "./structured";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

export interface AnthropicClientOptions {
  apiKey?: string;
  model?: string;
  /** Default effort when a request does not specify one. */
  effort?: ReasoningEffort;
  /** Pre-configured SDK client (tests, proxies). */
  client?: Anthropic;
}

/**
 * Anthropic (Claude) implementation of the LLM client.
 *
 * - Structured outputs (`output_config.format`) generated from the Zod schema.
 *   The response is fetched unparsed so `stop_reason` (refusal, max_tokens) is
 *   checked before any JSON parsing, then validated with the full Zod schema.
 * - Adaptive thinking is always on for Claude Opus 5.5; depth is controlled with `effort`.
 * - Server-side refusal fallbacks (`fallbacks: "default"`) are enabled so a
 *   classifier decline is retried on Anthropic's recommended fallback model.
 * - Fixed rules go in `system`; the case record goes in the user turn, with
 *   the documents block marked for prompt caching.
 */
export class AnthropicLLMClient implements LLMClient {
  readonly providerId = "anthropic" as const;
  readonly model: string;
  private readonly client: Anthropic;
  private readonly defaultEffort: ReasoningEffort;

  constructor(options: AnthropicClientOptions = {}) {
    if (!options.client && !options.apiKey && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      throw new AIConfigurationError("ANTHROPIC_API_KEY is not set");
    }
    this.client = options.client ?? new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
    this.model = options.model || DEFAULT_ANTHROPIC_MODEL;
    this.defaultEffort = options.effort ?? "medium";
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const context = request.context
      .filter((block) => block.text.trim().length > 0)
      .map((block) =>
        block.cacheable
          ? { type: "text" as const, text: block.text, cache_control: { type: "ephemeral" as const } }
          : { type: "text" as const, text: block.text },
      );

    let response;
    try {
      response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: request.maxOutputTokens ?? 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: request.system,
        messages: [{ role: "user", content: [...context, { type: "text", text: request.prompt }] }],
        output_config: {
          effort: request.effort ?? this.defaultEffort,
          format: betaZodOutputFormat(request.schema),
        },
      });
    } catch (error) {
      throw mapAnthropicError(error);
    }

    if (response.stop_reason === "refusal") {
      throw new AIRefusalError(response.stop_details?.category ?? undefined);
    }
    if (response.stop_reason === "max_tokens") {
      throw new AIOutputError(`Output truncated at max_tokens for task ${request.task}`);
    }

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      data: parseStructuredJson(text, request.schema, request.task),
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? undefined,
      },
    };
  }
}

function mapAnthropicError(error: unknown): Error {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AIConfigurationError(`Anthropic authentication failed: ${error.message}`);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AIProviderError(`Anthropic rate limit: ${error.message}`, true, { cause: error });
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new AIProviderError(`Anthropic rejected the request: ${error.message}`, false, { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AIProviderError(`Could not reach Anthropic: ${error.message}`, true, { cause: error });
  }
  if (error instanceof Anthropic.APIError) {
    const retryable = typeof error.status === "number" && error.status >= 500;
    return new AIProviderError(`Anthropic API error ${error.status}: ${error.message}`, retryable, {
      cause: error,
    });
  }
  return new AIProviderError(`Unexpected Anthropic client error: ${error instanceof Error ? error.message : String(error)}`, false, { cause: error });
}
