import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { listMessages } from "@/server/services/messages";

export const dynamic = "force-dynamic";

/** Latest discussion messages (used by the client to refresh after realtime events). */
export async function GET(_request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const messages = await listMessages(user, caseId);
    return NextResponse.json({ messages }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
