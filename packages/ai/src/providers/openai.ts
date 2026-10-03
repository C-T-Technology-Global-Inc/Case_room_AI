import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { AIConfigurationError, AIOutputError, AIProviderError, AIRefusalError } from "../errors";
import type { LLMClient, StructuredRequest, StructuredResponse } from "./llm-client";
import { parseStructuredJson } from "./structured";

export const DEFAULT_OPENAI_MODEL = "gpt-5";

export interface OpenAIClientOptions {
  apiKey?: string;
  model?: string;
  /** Pre-configured SDK client (tests, proxies). */
  client?: OpenAI;
}

/**
 * OpenAI implementation of the LLM client, using the Responses API with
 * strict JSON-schema structured outputs. The response is fetched unparsed so
 * refusals and truncation are detected before the JSON is parsed and validated. Output schemas in this package avoid
 * optional fields so they are compatible with OpenAI strict mode.
 */
export class OpenAILLMClient implements LLMClient {
  readonly providerId = "openai" as const;
  readonly model: string;
  private readonly client: OpenAI;

  constructor(options: OpenAIClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!options.client && !apiKey) throw new AIConfigurationError("OPENAI_API_KEY is not set");
    this.client = options.client ?? new OpenAI({ apiKey });
    this.model = options.model || DEFAULT_OPENAI_MODEL;
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const input = [...request.context.map((block) => block.text).filter((text) => text.trim()), request.prompt].join("\n\n");
    let response;
    try {
      // Unparsed response: refusals and incomplete output are checked before any JSON parsing.
      response = await this.client.responses.create({
        model: this.model,
        instructions: request.system,
        input,
        max_output_tokens: request.maxOutputTokens ?? 16000,
        text: { format: zodTextFormat(request.schema, request.schemaName) },
      });
    } catch (error) {
      throw mapOpenAIError(error);
    }

    const refusal = response.output
      .flatMap((item) => (item.type === "message" ? item.content : []))
      .find((part) => part.type === "refusal");
    if (refusal) throw new AIRefusalError(refusal.refusal);

    if (response.status === "incomplete") {
      throw new AIOutputError(
        `OpenAI response incomplete (${response.incomplete_details?.reason ?? "unknown"}) for task ${request.task}`,
      );
    }

    return {
      data: parseStructuredJson(response.output_text, request.schema, request.task),
      model: response.model,
      usage: {
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
        cacheReadTokens: response.usage?.input_tokens_details?.cached_tokens,
      },
    };
  }
}

function mapOpenAIError(error: unknown): Error {
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
    return new AIConfigurationError(`OpenAI authentication failed: ${error.message}`);
  }
  if (error instanceof OpenAI.RateLimitError) {
    return new AIProviderError(`OpenAI rate limit: ${error.message}`, true, { cause: error });
  }
  if (error instanceof OpenAI.BadRequestError) {
    return new AIProviderError(`OpenAI rejected the request: ${error.message}`, false, { cause: error });
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new AIProviderError(`Could not reach OpenAI: ${error.message}`, true, { cause: error });
  }
  if (error instanceof OpenAI.APIError) {
    const retryable = typeof error.status === "number" && error.status >= 500;
    return new AIProviderError(`OpenAI API error ${error.status}: ${error.message}`, retryable, {
      cause: error,
    });
  }
  return new AIProviderError(`Unexpected OpenAI client error: ${error instanceof Error ? error.message : String(error)}`, false, { cause: error });
}
