import "server-only";
import { randomBytes } from "node:crypto";
import type { DbClient } from "@ccr/database";

/**
 * Mention handles (`@DrSmith`) are unique per organization. Callers that insert
 * a member must hold the organization row lock, so two concurrent inserts
 * cannot pick the same free handle.
 */

/** Mention handle derived from a display name: "Dr. Emily Smith" -> "DrSmith", "Rachel Adams" -> "RachelAdams". */
export function baseHandle(name: string): string {
  const cleaned = name.replace(/[^A-Za-z\s.]/g, "").trim();
  if (/^dr\.?\s/i.test(cleaned)) {
    const last = cleaned.split(/\s+/).at(-1) ?? "";
    return `Dr${last.charAt(0).toUpperCase()}${last.slice(1)}`.replace(/[^A-Za-z0-9]/g, "");
  }
  return cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 30) || "User";
}

export async function uniqueHandle(db: DbClient, organizationId: string, name: string): Promise<string> {
  const base = baseHandle(name);
  const taken = new Set(
    (await db.user.findMany({ where: { organizationId, handle: { startsWith: base } }, select: { handle: true } })).map((u) => u.handle.toLowerCase()),
  );
  if (!taken.has(base.toLowerCase()) && base.toLowerCase() !== "ai") return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base}${randomBytes(2).toString("hex")}`;
}
