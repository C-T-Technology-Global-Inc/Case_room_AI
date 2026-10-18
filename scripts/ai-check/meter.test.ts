import Anthropic from "@anthropic-ai/sdk";
import { AIOutputError, AIProviderError, AnthropicLLMClient, type LLMClient, type StructuredRequest, type StructuredResponse } from "@ccr/ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BudgetExceeded, DryRunStop, estimateCall, MeteredClient, PRICES, reservationUsd } from "./meter";

/** Budget behaviour of the live AI check (Codex round 8, findings 1–4). */

const schema = z.object({ answer: z.string() });
const request = (overrides: Partial<StructuredRequest<{ answer: string }>> = {}): StructuredRequest<{ answer: string }> => ({
  task: "case_question",
  system: "Fixed rules.",
  context: [{ text: "Case record ".repeat(200), cacheable: true }],
  prompt: "Answer the question.",
  schema,
  schemaName: "answer",
  ...overrides,
});
const opus = PRICES["claude-opus-5-5"]!;

/** A provider stand-in that returns or throws whatever a test needs, and counts calls. */
function fakeClient(respond: (call: number) => StructuredResponse<{ answer: string }> | Error): LLMClient & { calls: number } {
  return {
    providerId: "anthropic",
    model: "claude-opus-5-5",
    calls: 0,
    async generateStructured<T>(): Promise<StructuredResponse<T>> {
      this.calls += 1;
      const result = respond(this.calls);
      if (result instanceof Error) throw result;
      return result as unknown as StructuredResponse<T>;
    },
  };
}
const ok = (usage: StructuredResponse<{ answer: string }>["usage"], model = "claude-opus-5-5") => ({ data: { answer: "ok" }, model, usage });
const meter = (inner: LLMClient | null, maxUsd: number) => new MeteredClient(inner, { providerId: "anthropic", model: "claude-opus-5-5", maxUsd });

describe("live AI check budget", () => {
  it("refuses a first call whose possible cost does not fit, without sending it", async () => {
    const inner = fakeClient(() => ok({ inputTokens: 1000, outputTokens: 1000 }));
    const metered = meter(inner, 0.001);
    await expect(metered.generateStructured(request())).rejects.toBeInstanceOf(BudgetExceeded);
    expect(inner.calls).toBe(0);
    expect(metered.spentUsd).toBe(0);
  });

  it("never lets spending pass the budget: the last call must fit in what is left", async () => {
    const reserved = reservationUsd(estimateCall(request()), opus);
    const inner = fakeClient(() => ok({ inputTokens: 2000, outputTokens: 3000 })); // well under the reservation
    const metered = meter(inner, reserved * 2.5);
    await metered.generateStructured(request());
    await metered.generateStructured(request());
    // Two calls spent little, but the remaining allowance is checked against a full reservation.
    const left = reserved * 2.5 - metered.spentUsd;
    if (left < reserved) await expect(metered.generateStructured(request())).rejects.toBeInstanceOf(BudgetExceeded);
    else await metered.generateStructured(request());
    expect(metered.spentUsd).toBeLessThanOrEqual(reserved * 2.5);
  });

  it("counts responses the adapter rejected, because they were billed", async () => {
    const truncated = () => {
      const error = new AIOutputError("Output truncated at max_tokens for task case_question");
      error.billing = { model: "claude-opus-5-5", usage: { inputTokens: 1000, outputTokens: 16000 } };
      return error;
    };
    const inner = fakeClient(truncated);
    const metered = meter(inner, 1);
    let attempts = 0;
    for (let i = 0; i < 8; i++) {
      try {
        await metered.generateStructured(request());
      } catch (error) {
        if (error instanceof BudgetExceeded) break;
        attempts += 1;
      }
    }
    // Each truncated reply cost $0.324; the meter stops before passing $1.
    expect(metered.spentUsd).toBeCloseTo(attempts * 0.324, 6);
    expect(metered.spentUsd).toBeLessThanOrEqual(1);
    expect(attempts).toBeLessThan(8);
    expect(metered.calls.every((call) => call.basis === "billed")).toBe(true);
  });

  it("keeps the whole reservation counted when the outcome is unknown (timeout, network)", async () => {
    const reserved = reservationUsd(estimateCall(request()), opus);
    const metered = meter(fakeClient(() => new AIProviderError("timeout", true)), 10);
    await expect(metered.generateStructured(request())).rejects.toBeInstanceOf(AIProviderError);
    expect(metered.spentUsd).toBeCloseTo(reserved, 9);
    expect(metered.calls[0]!.basis).toBe("reserved");
  });

  it("stops the run after a response from a model with no price", async () => {
    const metered = meter(fakeClient(() => ok({ inputTokens: 10, outputTokens: 10 }, "claude-unlisted-9")), 10);
    await metered.generateStructured(request());
    expect(metered.halted).toMatch(/claude-unlisted-9/);
    expect(metered.spentUsd).toBeGreaterThan(0);
    await expect(metered.generateStructured(request())).rejects.toBeInstanceOf(BudgetExceeded);
  });

  it("prices Sonnet cache reads at $0.10 per million tokens", () => {
    expect(PRICES["claude-sonnet-5-5"]).toEqual({ input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 });
  });

  it("estimates with the output cap the Anthropic adapter actually sends", async () => {
    for (const maxOutputTokens of [undefined, 24_000, 1_500]) {
      const sent: { body?: Record<string, unknown> } = {};
      const sdk = new Anthropic({
        apiKey: "test-key",
        maxRetries: 0,
        fetch: (async (_url: unknown, init?: RequestInit) => {
          sent.body = JSON.parse(String(init?.body));
          const usage = { input_tokens: 1, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
          const events = [
            { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage } },
            { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: '{"answer":"ok"}' } },
            { type: "content_block_stop", index: 0 },
            { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null, stop_details: null }, usage: { output_tokens: 1 } },
            { type: "message_stop" },
          ];
          const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
          return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
        }) as typeof fetch,
      });
      const probe = request(maxOutputTokens ? { maxOutputTokens } : {});
      await new AnthropicLLMClient({ client: sdk }).generateStructured(probe);
      expect(estimateCall(probe).outputTokens).toBe(sent.body!.max_tokens);
    }
  });

  it("makes no request in a dry run and reports an estimate", async () => {
    const metered = meter(null, Number.NaN);
    await expect(metered.generateStructured(request())).rejects.toBeInstanceOf(DryRunStop);
    expect(metered.calls[0]!.basis).toBe("estimate");
    expect(metered.calls[0]!.outputTokens).toBe(16_000);
  });

  it("refuses an invalid budget for real calls", () => {
    expect(() => meter(fakeClient(() => ok({})), Number.NaN)).toThrow(/positive/);
    expect(() => meter(fakeClient(() => ok({})), -1)).toThrow(/positive/);
  });
});
