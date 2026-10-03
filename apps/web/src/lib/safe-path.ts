const INTERNAL_ORIGIN = "https://internal.invalid";

/**
 * A same-origin path to redirect to, or the fallback. The value is parsed the
 * way a browser would (which strips tabs and newlines and treats `\` as `/`),
 * so `//evil.example`, `/\evil.example` and `/<TAB>/evil.example` are all refused.
 */
export function safePath(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string" || !value.startsWith("/")) return fallback;
  if (/[\u0000- \u007f\\]/.test(value)) return fallback;
  try {
    const url = new URL(value, INTERNAL_ORIGIN);
    return url.origin === INTERNAL_ORIGIN ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
