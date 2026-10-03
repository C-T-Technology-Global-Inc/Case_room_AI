/**
 * Database failures that mean "someone else is working on this right now":
 * lock wait timeout, deadlock, serialization failure, or an interactive
 * transaction that ran out of time. The whole transaction was rolled back,
 * so the user can simply retry.
 */
const RETRYABLE_CODES = new Set(["P2028", "P2034", "55P03", "40P01", "40001"]);
const RETRYABLE_MESSAGE = /lock timeout|lock_not_available|deadlock detected|could not serialize|transaction already closed|expired transaction/i;

export function isRetryableDatabaseError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
    const { code, meta, message, cause } = current as { code?: unknown; meta?: { code?: unknown }; message?: unknown; cause?: unknown };
    if (typeof code === "string" && RETRYABLE_CODES.has(code)) return true;
    if (typeof meta?.code === "string" && RETRYABLE_CODES.has(meta.code)) return true;
    if (typeof message === "string" && RETRYABLE_MESSAGE.test(message)) return true;
    current = cause;
  }
  return false;
}

export const BUSY_MESSAGE = "Someone else is updating this record right now. Nothing was saved; please try again.";
