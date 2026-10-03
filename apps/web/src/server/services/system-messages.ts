import "server-only";
import type { DbClient, Prisma } from "@ccr/database";
import type { SystemMessageMetadata } from "@ccr/types";

/** Post a SYSTEM message into a case discussion (e.g. "Decision #2 approved"). */
export async function postSystemMessage(
  db: DbClient,
  input: { caseRoomId: string; content: string; event: string; refType?: string | null; refId?: string | null },
) {
  const metadata: SystemMessageMetadata = {
    kind: "system",
    event: input.event,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
  };
  return db.message.create({
    data: {
      caseRoomId: input.caseRoomId,
      type: "SYSTEM",
      content: input.content,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}

/** Mark a case room as recently active (drives "last update" sorting). */
export async function touchCaseRoom(db: DbClient, caseRoomId: string) {
  await db.caseRoom.update({ where: { id: caseRoomId }, data: { updatedAt: new Date() } });
}
