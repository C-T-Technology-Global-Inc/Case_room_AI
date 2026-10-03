import type { TransactionClient } from "./client";
import { Prisma } from "./generated/prisma/client";

/**
 * Tables whose rows serialize concurrent workflows (numbering, reviews,
 * sign-off, org roles, invitations, memberships of one person).
 *
 * Lock order, to stay deadlock-free: Identity → Organization → Invitation, and
 * CaseRoom → Decision / CaseBrief. Never take a lock earlier in its chain
 * after a later one in the same transaction.
 */
export type LockableTable = "Identity" | "CaseRoom" | "Decision" | "CaseBrief" | "Organization" | "Invitation";

/**
 * Take a row lock held until the transaction ends. Concurrent transactions that
 * lock (or update) the same row wait, then re-read fresh state. `FOR NO KEY UPDATE`
 * does not block inserts of rows that reference this one (messages, approvals).
 * Returns false when the row does not exist.
 */
const LOCK_TIMEOUT = "3s";

export async function lockRow(tx: TransactionClient, table: LockableTable, id: string): Promise<boolean> {
  // Give up waiting well before the interactive transaction's own 5 s budget, with a
  // clear "lock not available" error (55P03) that callers report as "busy, retry".
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE id = ${id} FOR NO KEY UPDATE`,
  );
  return rows.length > 0;
}
