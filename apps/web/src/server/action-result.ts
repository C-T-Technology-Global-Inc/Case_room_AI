import "server-only";
import { AIError } from "@ccr/ai";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { BUSY_MESSAGE, isRetryableDatabaseError } from "./db-errors";
import { AppError } from "./errors";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Run a server action body and convert failures into a serializable result.
 * Next.js control-flow errors (redirect, notFound) are re-thrown.
 */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AppError) return { ok: false, error: error.message };
    if (error instanceof AIError) {
      console.error("[ai]", error.message);
      return { ok: false, error: error.userMessage };
    }
    if (error instanceof ZodError) {
      return { ok: false, error: error.issues[0]?.message ?? "Some fields are invalid." };
    }
    if (isRetryableDatabaseError(error)) {
      console.warn("[action] transaction rolled back (busy)", error instanceof Error ? error.message : error);
      return { ok: false, error: BUSY_MESSAGE };
    }
    console.error("[action]", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
