import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AIOutputError, AIRefusalError } from "../errors";
import { AnthropicLLMClient } from "./anthropic";
import type { StructuredRequest } from "./llm-client";
import { OpenAILLMClient } from "./openai";

/**
 * Provider tests at the HTTP layer: the real SDKs run against a stubbed
 * `fetch`, so SDK-side parsing behaviour (not just our interface) is covered.
 */

const schema = z.object({ answer: z.string(), confidence: z.enum(["high", "low"]) });

const request: StructuredRequest<z.infer<typeof schema>> = {
  task: "test_task",
  system: "Fixed rules.",
  context: [{ text: "<case_record>data</case_record>", cacheable: true }, { text: "" }],
  prompt: "Answer the question.",
  schema,
  schemaName: "test_answer",
};

function stubFetch(body: unknown, captured: { body?: Record<string, unknown> } = {}) {
  return async (_url: unknown, init?: { body?: unknown }) => {
    if (typeof init?.body === "string") captured.body = JSON.parse(init.body) as Record<string, unknown>;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
}

function anthropicMessage(stopReason: string, text: string, extra: Record<string, unknown> = {}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    ...extra,
  };
}

function anthropicClient(body: unknown, captured?: { body?: Record<string, unknown> }) {
  const client = new Anthropic({ apiKey: "test-key", fetch: stubFetch(body, captured) as typeof fetch, maxRetries: 0 });
  return new AnthropicLLMClient({ client });
}

describe("AnthropicLLMClient", () => {
  it("parses and validates structured output, with case data in the user turn", async () => {
    const captured: { body?: Record<string, unknown> } = {};
    const llm = anthropicClient(anthropicMessage("end_turn", '{"answer":"ok","confidence":"high"}'), captured);
    const result = await llm.generateStructured(request);
    expect(result.data).toEqual({ answer: "ok", confidence: "high" });
    expect(captured.body?.system).toBe("Fixed rules.");
    expect(captured.body?.fallbacks).toBe("default");
    const content = (captured.body?.messages as Array<{ content: Array<{ text: string; cache_control?: unknown }> }>)[0]!.content;
    expect(content).toHaveLength(2); // empty context block dropped
    expect(content[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(content.at(-1)!.text).toBe("Answer the question.");
  });

  it("reports a refusal as a refusal, even when the text is not JSON", async () => {
    const llm = anthropicClient(anthropicMessage("refusal", "I cannot help with that.", { stop_details: { type: "refusal", category: "bio", explanation: null } }));
    await expect(llm.generateStructured(request)).rejects.toBeInstanceOf(AIRefusalError);
  });

  it("reports truncation before trying to parse partial JSON", async () => {
    const llm = anthropicClient(anthropicMessage("max_tokens", '{"answer":"cut'));
    await expect(llm.generateStructured(request)).rejects.toThrow(/truncated/);
  });

  it("rejects output that does not match the schema", async () => {
    const llm = anthropicClient(anthropicMessage("end_turn", '{"answer":"ok","confidence":"certain"}'));
    await expect(llm.generateStructured(request)).rejects.toBeInstanceOf(AIOutputError);
  });
});

function openAIResponse(status: "completed" | "incomplete", content: unknown[], extra: Record<string, unknown> = {}) {
  return {
    id: "resp_test",
    object: "response",
    created_at: 0,
    model: "gpt-test",
    status,
    output: [{ type: "message", id: "msg_1", status, role: "assistant", content }],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
    ...extra,
  };
}

function openAIClient(body: unknown, captured?: { body?: Record<string, unknown> }) {
  const client = new OpenAI({ apiKey: "test-key", fetch: stubFetch(body, captured) as typeof fetch, maxRetries: 0 });
  return new OpenAILLMClient({ client, model: "gpt-test" });
}

describe("OpenAILLMClient", () => {
  it("parses structured output and sends rules as instructions", async () => {
    const captured: { body?: Record<string, unknown> } = {};
    const llm = openAIClient(openAIResponse("completed", [{ type: "output_text", text: '{"answer":"ok","confidence":"low"}', annotations: [] }]), captured);
    const result = await llm.generateStructured(request);
    expect(result.data).toEqual({ answer: "ok", confidence: "low" });
    expect(captured.body?.instructions).toBe("Fixed rules.");
    expect(String(captured.body?.input)).toContain("<case_record>data</case_record>");
    expect((captured.body?.text as { format: { strict: boolean } }).format.strict).toBe(true);
  });

  it("reports refusals", async () => {
    const llm = openAIClient(openAIResponse("completed", [{ type: "refusal", refusal: "I can't help with that." }]));
    await expect(llm.generateStructured(request)).rejects.toBeInstanceOf(AIRefusalError);
  });

  it("reports incomplete output before parsing it", async () => {
    const llm = openAIClient(
      openAIResponse("incomplete", [{ type: "output_text", text: '{"answer":"cu', annotations: [] }], { incomplete_details: { reason: "max_output_tokens" } }),
    );
    await expect(llm.generateStructured(request)).rejects.toThrow(/incomplete \(max_output_tokens\)/);
  });
});
