import "server-only";
import { lockRow, type Prisma, type TransactionClient } from "@ccr/database";
import type { CaseMemory } from "@ccr/types";
import { emptyCaseMemory, parseCaseMemory } from "@ccr/types";

/**
 * Read-modify-write of the shared case memory inside the caller's transaction.
 * Every memory writer locks the case row first, so concurrent writers (two
 * documents processed at once, a summary) apply one after the other and none
 * overwrites another's facts. The version column still increases on each write.
 */
export async function updateMemory(tx: TransactionClient, caseRoomId: string, update: (memory: CaseMemory) => CaseMemory) {
  await lockRow(tx, "CaseRoom", caseRoomId);
  const row = await tx.caseMemory.findUnique({ where: { caseRoomId } });
  const next = update((row && parseCaseMemory(row.data)) || emptyCaseMemory());
  const data = next as unknown as Prisma.InputJsonValue;
  if (row) await tx.caseMemory.update({ where: { caseRoomId }, data: { data, version: { increment: 1 } } });
  else await tx.caseMemory.create({ data: { caseRoomId, data, version: 1 } });
  return next;
}
