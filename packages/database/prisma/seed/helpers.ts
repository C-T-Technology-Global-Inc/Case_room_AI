import type { SourceRef } from "@ccr/types";
import type { ClinicalDocument, Organization, PrismaClient, User } from "../../src/generated/prisma/client";
import { Prisma } from "../../src/generated/prisma/client";

/**
 * Seed helpers. All clinical dates are relative to the moment the seed runs,
 * so the demo always looks current ("CT 18 days ago", "tumor board in 2 days").
 */

export const SEED_NOW = new Date();

export const SYNTHETIC_HEADER = "SYNTHETIC DEMO RECORD - NOT A REAL PATIENT";

/** Date-only value (UTC midnight) for the calendar day `days` before today (negative = future). */
export function day(days: number): Date {
  const local = new Date(SEED_NOW);
  local.setDate(local.getDate() - days);
  return new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
}

/** Timestamp on the calendar day `days` before today at local HH:MM. */
export function at(days: number, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  const local = new Date(SEED_NOW);
  local.setDate(local.getDate() - days);
  local.setHours(hours ?? 9, minutes ?? 0, 0, 0);
  return local;
}

/** "Sep 12, 2026" for use inside document text. */
export function fmt(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Date of birth for someone who is `age` years old, with a birthday `monthsAgo` months ago. */
export function dobForAge(age: number, monthsAgo: number, dayOfMonth = 14): Date {
  const local = new Date(SEED_NOW);
  local.setMonth(local.getMonth() - monthsAgo);
  return new Date(Date.UTC(local.getFullYear() - age, local.getMonth(), dayOfMonth));
}

export interface SeedContext {
  prisma: PrismaClient;
  org: Organization;
  users: Record<string, User>;
}

/** SourceRef for a seeded document; `excerpt` must be copied verbatim from the document text. */
export function docRef(doc: ClinicalDocument, excerpt?: string): SourceRef {
  if (excerpt && !doc.rawText.replace(/\s+/g, " ").includes(excerpt.replace(/\s+/g, " "))) {
    throw new Error(`Seed excerpt is not verbatim in "${doc.title}": ${excerpt}`);
  }
  return {
    kind: "document",
    id: doc.id,
    label: doc.title,
    date: iso(doc.documentDate),
    documentType: doc.type,
    excerpt: excerpt ?? null,
    verified: excerpt ? true : undefined,
  };
}

export function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

interface AuditInput {
  caseRoomId?: string | null;
  userId?: string | null;
  actorType?: "USER" | "AI" | "SYSTEM";
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export async function audit(ctx: SeedContext, input: AuditInput) {
  await ctx.prisma.auditEvent.create({
    data: {
      organizationId: ctx.org.id,
      caseRoomId: input.caseRoomId ?? null,
      userId: input.userId ?? null,
      actorType: input.actorType ?? "USER",
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      metadata: input.metadata ? json(input.metadata) : undefined,
      createdAt: input.createdAt,
    },
  });
}
