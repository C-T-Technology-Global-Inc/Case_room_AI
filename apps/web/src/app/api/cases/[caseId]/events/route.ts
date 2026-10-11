import type { CaseRealtimeEvent } from "@ccr/types";
import { recheckSessionUser } from "@/server/auth/memberships";
import { getSessionUser } from "@/server/auth/session";
import { findAccessibleCase } from "@/server/authz/case-access";
import { realtime } from "@/server/realtime/bus";
import { caseVersion } from "@/server/services/cases";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_HEARTBEAT_MS = 20_000;

/** Keep-alive interval; access is re-checked at the same pace. REALTIME_HEARTBEAT_MS shortens it in tests. */
function heartbeatMs(): number {
  const configured = Number.parseInt(process.env.REALTIME_HEARTBEAT_MS ?? "", 10);
  return Number.isFinite(configured) && configured >= 50 ? configured : DEFAULT_HEARTBEAT_MS;
}

/**
 * Server-Sent Events stream for one case room: discussion updates, AI activity,
 * presence and typing indicators, and "data changed" signals.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const room = await findAccessibleCase(user, caseId);
  if (!room) return new Response("Not found", { status: 404 });

  const encoder = new TextEncoder();
  let cleanup: () => void = () => undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let cleaned = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let unsubscribe: () => void = () => undefined;

      // Runs exactly once, whether the client left (abort/cancel) or a write failed.
      cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        clearInterval(heartbeat);
        unsubscribe();
        if (realtime.disconnect(caseId, user.id)) {
          void realtime.publish({ type: "presence", caseRoomId: caseId, userId: user.id, name: user.name, status: "offline" });
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      const write = (chunk: string) => {
        if (cleaned) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const send = (event: string, data: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const announce = () =>
        realtime.publish({ type: "presence", caseRoomId: caseId, userId: user.id, name: user.name, status: "online" });

      realtime.connect(caseId, user.id);
      unsubscribe = realtime.subscribe(caseId, (event: CaseRealtimeEvent) => send("case", event));
      request.signal.addEventListener("abort", () => cleanup());
      // Read the case version only after subscribing: a change committed before this read is in
      // the version, and any later change arrives as an event, so nothing falls in between.
      const version = await caseVersion(caseId);
      // Sent on every (re)connection. Clients reload when the version differs from what they
      // rendered, and always after a reconnect.
      send("ready", { presence: realtime.presenceSnapshot(caseId), userId: user.id, version });
      void announce();

      // The stream outlives the request that authorized it. Re-check at every heartbeat that the
      // membership is still active, the password was not changed since, and the case is still
      // visible with the current role; otherwise tell the client and close (fail closed on errors).
      let checking = false;
      const stillAllowed = async () => {
        const current = await recheckSessionUser(user);
        return current !== null && (await findAccessibleCase({ ...user, role: current.role }, caseId)) !== null;
      };
      const tick = async () => {
        if (checking || cleaned) return;
        checking = true;
        try {
          if (!(await stillAllowed())) {
            send("revoked", {});
            cleanup();
            return;
          }
        } catch (error) {
          console.warn("[realtime] access re-check failed; closing the stream", error instanceof Error ? error.message : error);
          cleanup();
          return;
        } finally {
          checking = false;
        }
        write(": keep-alive\n\n");
        void announce();
      };
      if (!cleaned) heartbeat = setInterval(() => void tick(), heartbeatMs());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
