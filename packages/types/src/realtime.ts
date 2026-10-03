/**
 * Realtime events broadcast to everyone viewing a case room.
 * Events are small invalidation signals; clients refetch the data they need.
 */

export const CASE_SCOPES = [
  "case",
  "documents",
  "timeline",
  "messages",
  "decisions",
  "tasks",
  "briefs",
  "memory",
  "members",
  "audit",
] as const;
export type CaseScope = (typeof CASE_SCOPES)[number];

export type CaseRealtimeEvent =
  | { type: "message.created"; caseRoomId: string; messageId: string }
  | { type: "message.updated"; caseRoomId: string; messageId: string }
  | {
      type: "ai.thinking";
      caseRoomId: string;
      requestId: string;
      requestedBy: string;
      label: string;
    }
  | { type: "ai.done"; caseRoomId: string; requestId: string }
  | { type: "case.updated"; caseRoomId: string; scopes: CaseScope[]; actorId: string | null }
  | {
      type: "presence";
      caseRoomId: string;
      userId: string;
      name: string;
      status: "online" | "offline";
    }
  | { type: "typing"; caseRoomId: string; userId: string; name: string }
  /** Events may have been missed (listener reconnected); clients reload what they show. */
  | { type: "resync"; caseRoomId: string };

export type CaseRealtimeEventType = CaseRealtimeEvent["type"];
