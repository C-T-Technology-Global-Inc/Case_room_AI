import type { z } from "zod";
import { AIOutputError } from "../errors";

/**
 * Parse and validate a model's structured text output. Providers call this
 * only after they have ruled out refusals and truncation, so a refusal is
 * never misreported as malformed output.
 */
export function parseStructuredJson<T>(text: string, schema: z.ZodType<T>, task: string): T {
  if (!text.trim()) throw new AIOutputError(`Empty structured output for task ${task}`);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new AIOutputError(`Structured output for task ${task} is not valid JSON`, { cause: error });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new AIOutputError(`Structured output for task ${task} does not match the schema: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }
  return parsed.data;
}
