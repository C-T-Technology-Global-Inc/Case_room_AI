import { getSessionUser } from "@/server/auth/session";
import { findAccessibleCase } from "@/server/authz/case-access";
import { realtime } from "@/server/realtime/bus";

export const dynamic = "force-dynamic";

/** Broadcast a "user is typing" signal to other viewers of the case. */
export async function POST(_request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const user = await getSessionUser();
  if (!user) return new Response(null, { status: 401 });
  const room = await findAccessibleCase(user, caseId);
  if (!room) return new Response(null, { status: 404 });
  await realtime.publish({ type: "typing", caseRoomId: caseId, userId: user.id, name: user.name });
  return new Response(null, { status: 204 });
}
