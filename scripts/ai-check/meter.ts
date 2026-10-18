/**
 * Cost metering and budget admission for the live AI check (scripts/live-ai-check.ts).
 *
 * Before each paid call, the meter reserves the most that call can cost: a
 * conservative estimate of its input (prompt, case record and JSON schema,
 * priced at the cache-write rate, the highest input rate) plus its full
 * output cap. A call runs only if that reservation fits in what is left of the
 * budget, so the budget is never exceeded by the meter's own accounting. Keep a
 * spending limit in the provider console as well: a local estimate is not an
 * account-wide billing guarantee.
 *
 * After the call, the reservation is replaced by the billed usage, including
 * responses the adapter rejected (refusal, truncation, invalid output): those
 * were billed too. When usage is unknown (timeout, network error), the full
 * reservation stays counted. A response from a model with no price ends the run.
 */
import { AIConfigurationError, AIError, AIProviderError, DEFAULT_MAX_OUTPUT_TOKENS } from "@ccr/ai";
import type { LLMClient, LLMUsage, StructuredRequest, StructuredResponse } from "@ccr/ai";
import { z } from "zod";

// ---- Prices -----------------------------------------------------------------------

export interface Price {
  /** USD per million uncached input tokens. */
  input: number;
  output: number;
  cacheRead: number;
  /** Five-minute cache write. */
  cacheWrite: number;
}

/**
 * Anthropic first-party rates, USD per million tokens. Checked 2026-10-14
 * against platform.claude.com model pages (Opus 5.5, Sonnet 5.5, Fable 5.1).
 * Update this table, with its date, when prices change.
 */
export const PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
};

export function priceOf(model: string): Price | null {
  const known = Object.keys(PRICES).find((id) => model === id || model.startsWith(`${id}-`));
  return known ? PRICES[known]! : null;
}

/** The most expensive known rates: used for a response from a model with no price. */
const HIGHEST: Price = Object.values(PRICES).reduce((max, price) => ({
  input: Math.max(max.input, price.input),
  output: Math.max(max.output, price.output),
  cacheRead: Math.max(max.cacheRead, price.cacheRead),
  cacheWrite: Math.max(max.cacheWrite, price.cacheWrite),
}));

export function costOf(usage: LLMUsage, price: Price): number {
  return (
    ((usage.inputTokens ?? 0) * price.input +
      (usage.outputTokens ?? 0) * price.output +
      (usage.cacheReadTokens ?? 0) * price.cacheRead +
      (usage.cacheWriteTokens ?? 0) * price.cacheWrite) /
    1e6
  );
}

// ---- Estimates --------------------------------------------------------------------------

/** Characters per token used for the input estimate: deliberately low (English is about 4), so the estimate errs high. */
const CHARS_PER_TOKEN = 2.5;
/** Request framing, tool/format instructions added by the provider. */
const PROTOCOL_OVERHEAD_TOKENS = 1_500;

export interface CallEstimate {
  inputTokens: number;
  /** The output cap the adapter sends (reasoning tokens count toward it). */
  outputTokens: number;
}

function schemaChars(schema: z.ZodType<unknown>): number {
  try {
    return JSON.stringify(z.toJSONSchema(schema)).length;
  } catch {
    return 8_000; // schemas that cannot be converted: assume a large one
  }
}

/** A conservative estimate of one request: overestimates input, uses the real output cap. */
export function estimateCall<T>(request: StructuredRequest<T>): CallEstimate {
  const chars =
    request.system.length + request.context.reduce((sum, block) => sum + block.text.length, 0) + request.prompt.length + schemaChars(request.schema);
  return {
    inputTokens: Math.ceil(chars / CHARS_PER_TOKEN) + PROTOCOL_OVERHEAD_TOKENS,
    outputTokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  };
}

/** The most this call can cost: all input at the highest input rate (cache write), full output cap. */
export function reservationUsd(estimate: CallEstimate, price: Price): number {
  return (estimate.inputTokens * Math.max(price.input, price.cacheWrite) + estimate.outputTokens * price.output) / 1e6;
}

// ---- Metering client ----------------------------------------------------------------------

export interface CallRecord {
  case: string;
  step: string;
  task: string;
  ok: boolean;
  error?: string;
  latencyMs: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** USD counted for this call: billed usage, or the reservation when usage is unknown. */
  usd: number;
  /** How `usd` was obtained. */
  basis: "estimate" | "billed" | "reserved" | "not billed";
}

/** The next call does not fit in what is left of the budget (or the run was halted). */
export class BudgetExceeded extends Error {}
/** Dry run: the request was estimated, not sent. */
export class DryRunStop extends Error {}

export class MeteredClient implements LLMClient {
  readonly providerId: "anthropic" | "openai";
  readonly model: string;
  readonly calls: CallRecord[] = [];
  spentUsd = 0;
  /** Set when the run must stop (unknown price, provider configuration error). */
  halted: string | null = null;
  current = { case: "", step: "" };
  private readonly price: Price;
  private readonly maxUsd: number;

  /**
   * @param inner the real client, or null for a dry run (estimates only)
   * @param maxUsd budget for real calls; ignored in a dry run
   */
  constructor(
    private readonly inner: LLMClient | null,
    options: { providerId: "anthropic" | "openai"; model: string; maxUsd: number },
  ) {
    const price = priceOf(options.model);
    if (!price) throw new Error(`No price for ${options.model}: the budget cannot be enforced. Add it to PRICES.`);
    if (inner && !(Number.isFinite(options.maxUsd) && options.maxUsd > 0)) throw new Error("The budget must be a positive number of dollars.");
    this.price = price;
    this.providerId = options.providerId;
    this.model = options.model;
    this.maxUsd = options.maxUsd;
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const estimate = estimateCall(request);
    const reserved = reservationUsd(estimate, this.price);
    const base = { case: this.current.case, step: this.current.step, task: request.task };

    if (!this.inner) {
      this.spentUsd += reserved;
      this.calls.push({ ...base, ok: true, latencyMs: 0, model: this.model, inputTokens: estimate.inputTokens, outputTokens: estimate.outputTokens, usd: reserved, basis: "estimate" });
      throw new DryRunStop();
    }
    if (this.halted) throw new BudgetExceeded(`Run halted: ${this.halted}`);
    if (this.spentUsd + reserved > this.maxUsd) {
      throw new BudgetExceeded(
        `Next call (${request.task}) may cost up to $${reserved.toFixed(4)}; only $${(this.maxUsd - this.spentUsd).toFixed(4)} of $${this.maxUsd} is left`,
      );
    }

    const started = Date.now();
    try {
      const response = await this.inner.generateStructured(request);
      this.record(base, started, response.model, response.usage ?? null, reserved, true);
      return response;
    } catch (error) {
      const billing = error instanceof AIError ? error.billing : undefined;
      if (billing) {
        this.record(base, started, billing.model, billing.usage, reserved, false, error);
      } else if (error instanceof AIConfigurationError || (error instanceof AIProviderError && !error.retryable)) {
        // Rejected before any generation (authentication, invalid request): not billed.
        if (error instanceof AIConfigurationError) this.halted = error.message;
        this.calls.push({ ...base, ok: false, error: describe(error), latencyMs: Date.now() - started, usd: 0, basis: "not billed" });
      } else {
        // Unknown outcome (timeout, network, 5xx): keep the whole reservation counted.
        this.spentUsd += reserved;
        this.calls.push({ ...base, ok: false, error: describe(error), latencyMs: Date.now() - started, usd: reserved, basis: "reserved" });
      }
      throw error;
    }
  }

  private record(
    base: { case: string; step: string; task: string },
    started: number,
    model: string,
    usage: LLMUsage | null,
    reserved: number,
    ok: boolean,
    error?: unknown,
  ) {
    const price = priceOf(model);
    let usd: number;
    let basis: CallRecord["basis"];
    if (!usage) {
      usd = reserved;
      basis = "reserved";
    } else if (!price) {
      // Served by a model with no price (e.g. a fallback): charge it at the highest known rates and stop.
      usd = Math.max(reserved, costOf(usage, HIGHEST));
      basis = "reserved";
      this.halted = `response from ${model}, which has no price`;
    } else {
      usd = costOf(usage, price);
      basis = "billed";
    }
    this.spentUsd += usd;
    this.calls.push({
      ...base,
      ok,
      ...(error ? { error: describe(error) } : {}),
      latencyMs: Date.now() - started,
      model,
      ...(usage ?? {}),
      usd,
      basis,
    });
  }
}

export function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 500);
  return String(error).slice(0, 500);
}
