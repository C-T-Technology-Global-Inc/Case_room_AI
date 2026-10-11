/**
 * Public base URL of this deployment (APP_URL), used in links sent by email
 * and shown to admins. Never derived from the request's Host header: a forged
 * Host would otherwise put an attacker's domain into password reset links.
 * Outside production it falls back to the local dev server; in production it
 * is null until APP_URL is set.
 */
export function appUrl(): string | null {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? null : "http://localhost:3000";
}

/** Absolute link to a path of this app; relative when APP_URL is not set (admins can still copy it). */
export function appLink(path: string): string {
  return `${appUrl() ?? ""}${path}`;
}
