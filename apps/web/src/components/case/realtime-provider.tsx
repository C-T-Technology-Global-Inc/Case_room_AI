"use client";

import type { CaseRealtimeEvent } from "@ccr/types";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * Client side of case-room realtime: one EventSource per open case room.
 * Exposes presence, typing and AI-activity state, and lets components
 * subscribe to raw events (e.g. the discussion refetches on message events).
 * Any "case.updated" signal triggers a debounced router.refresh() so server
 * components re-render with fresh data.
 *
 * Events are not replayed. After a reconnect (a repeated "ready") or a server
 * "resync", the provider refreshes the page, clears AI activity that may have
 * missed its "ai.done", and forwards a "resync" event so listeners reload too.
 */

interface PresenceUser {
  userId: string;
  name: string;
  lastSeen: number;
}

interface AIActivity {
  requestId: string;
  label: string;
  requestedBy: string;
}

interface RealtimeState {
  connected: boolean;
  online: PresenceUser[];
  onlineIds: Set<string>;
  typing: Array<{ userId: string; name: string }>;
  aiActivity: AIActivity[];
  subscribe: (listener: (event: CaseRealtimeEvent) => void) => () => void;
  notifyTyping: () => void;
}

const RealtimeContext = createContext<RealtimeState | null>(null);

const PRESENCE_TTL_MS = 50_000;
/** Backoff for reconnecting after the browser gave up on the stream (see "error" below). */
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const TYPING_TTL_MS = 4_000;

export function CaseRealtimeProvider({
  caseId,
  currentUser,
  version,
  children,
}: {
  caseId: string;
  currentUser: { id: string; name: string };
  /** Case version (`updatedAt`) the page was rendered from; compared with the server's on connect. */
  version: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [presence, setPresence] = useState<Map<string, PresenceUser>>(() => new Map());
  const [typing, setTyping] = useState<Map<string, { name: string; until: number }>>(() => new Map());
  const [aiActivity, setAIActivity] = useState<AIActivity[]>([]);
  const listeners = useRef(new Set<(event: CaseRealtimeEvent) => void>());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);
  const renderedVersion = useRef(version);
  useEffect(() => {
    renderedVersion.current = version;
  }, [version]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 350);
  }, [router]);

  useEffect(() => {
    let source: EventSource | null = null;
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = RECONNECT_MIN_MS;
    // Counts "ready" events across reconnections: every one after the first means events may have been missed.
    let readyCount = 0;
    const emit = (event: CaseRealtimeEvent) => {
      for (const listener of listeners.current) listener(event);
    };
    // Anything may have changed while events were not being received.
    const resync = () => {
      setAIActivity([]);
      scheduleRefresh();
      emit({ type: "resync", caseRoomId: caseId });
    };

    const onOpen = () => setConnected(true);
    const onError = () => {
      setConnected(false);
      // The browser retries network errors by itself, but gives up for good after an HTTP error
      // (for example a 502 from a proxy during a deploy). Reconnect with backoff in that case.
      if (disposed || retryTimer || source?.readyState !== EventSource.CLOSED) return;
      const delay = retryDelay * (0.75 + Math.random() * 0.5);
      retryDelay = Math.min(retryDelay * 2, RECONNECT_MAX_MS);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!disposed) connect();
      }, delay);
    };
    const onReady = (message: Event) => {
      setConnected(true);
      retryDelay = RECONNECT_MIN_MS;
      const data = JSON.parse((message as MessageEvent<string>).data) as {
        presence: Array<{ userId: string; name: string }>;
        version: string | null;
      };
      // The snapshot replaces local presence: entries from before a disconnect may be stale.
      const next = new Map<string, PresenceUser>();
      for (const entry of data.presence) next.set(entry.userId, { ...entry, lastSeen: Date.now() });
      next.set(currentUser.id, { userId: currentUser.id, name: currentUser.name, lastSeen: Date.now() });
      setPresence(next);
      readyCount += 1;
      // After a reconnect anything may have changed; on the first connection, only if the case
      // changed between rendering this page and subscribing.
      if (readyCount > 1 || data.version !== renderedVersion.current) resync();
    };
    const onCase = (message: Event) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as CaseRealtimeEvent;
      if (event.type === "resync") {
        resync();
        return;
      }
      switch (event.type) {
        case "presence":
          setPresence((previous) => {
            const next = new Map(previous);
            if (event.status === "online") next.set(event.userId, { userId: event.userId, name: event.name, lastSeen: Date.now() });
            else if (event.userId !== currentUser.id) next.delete(event.userId);
            return next;
          });
          break;
        case "typing":
          if (event.userId !== currentUser.id) {
            setTyping((previous) => new Map(previous).set(event.userId, { name: event.name, until: Date.now() + TYPING_TTL_MS }));
          }
          break;
        case "ai.thinking":
          setAIActivity((previous) => [...previous.filter((a) => a.requestId !== event.requestId), { requestId: event.requestId, label: event.label, requestedBy: event.requestedBy }]);
          break;
        case "ai.done":
          setAIActivity((previous) => previous.filter((a) => a.requestId !== event.requestId));
          break;
        case "case.updated":
          scheduleRefresh();
          break;
        case "message.created":
        case "message.updated":
          break;
      }
      emit(event);
    };

    function connect() {
      source?.close();
      source = new EventSource(`/api/cases/${caseId}/events`);
      source.addEventListener("open", onOpen);
      source.addEventListener("error", onError);
      source.addEventListener("ready", onReady);
      source.addEventListener("case", onCase);
    }
    connect();

    const sweep = setInterval(() => {
      const now = Date.now();
      setPresence((previous) => {
        const stale = [...previous.values()].some((p) => p.userId !== currentUser.id && now - p.lastSeen > PRESENCE_TTL_MS);
        if (!stale) return previous;
        return new Map([...previous].filter(([id, p]) => id === currentUser.id || now - p.lastSeen <= PRESENCE_TTL_MS));
      });
      setTyping((previous) => {
        if (![...previous.values()].some((t) => t.until < now)) return previous;
        return new Map([...previous].filter(([, t]) => t.until >= now));
      });
    }, 2_000);

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
      clearInterval(sweep);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [caseId, currentUser.id, currentUser.name, scheduleRefresh]);

  const subscribe = useCallback((listener: (event: CaseRealtimeEvent) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < 2_500) return;
    lastTypingSent.current = now;
    void fetch(`/api/cases/${caseId}/typing`, { method: "POST" }).catch(() => undefined);
  }, [caseId]);

  const value = useMemo<RealtimeState>(() => {
    const online = [...presence.values()];
    return {
      connected,
      online,
      onlineIds: new Set(online.map((p) => p.userId)),
      typing: [...typing.entries()].map(([userId, t]) => ({ userId, name: t.name })),
      aiActivity,
      subscribe,
      notifyTyping,
    };
  }, [connected, presence, typing, aiActivity, subscribe, notifyTyping]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useCaseRealtime(): RealtimeState {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error("useCaseRealtime must be used inside CaseRealtimeProvider");
  return context;
}
