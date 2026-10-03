import "server-only";
import { EventEmitter } from "node:events";
import { prisma } from "@ccr/database";
import type { CaseRealtimeEvent, CaseScope } from "@ccr/types";
import pg from "pg";

/**
 * Realtime fan-out for case rooms.
 *
 * Events are published with Postgres NOTIFY and received by one dedicated
 * LISTEN connection per server process, which re-emits them to the SSE
 * streams connected to that process. This works across multiple app
 * instances without extra infrastructure. If LISTEN cannot be established
 * (e.g. a pooler without session support), events fall back to in-process
 * delivery and LISTEN is retried with backoff. Payloads are small
 * invalidation signals, never clinical content.
 *
 * Delivery is best effort: there is no replay. Whenever the listener is
 * (re-)established, every subscriber receives a `resync` event so clients
 * reload what they show (they do the same when their own SSE stream reconnects).
 *
 * Publishing never waits for the listener to connect, and NOTIFY has a time
 * budget: a mutation that already committed must not hang on realtime. Events
 * are idempotent invalidations, so a rare double delivery (local fallback after
 * a slow NOTIFY that still lands) only causes an extra refetch.
 */

const CHANNEL = "ccr_case_events";
export const PRESENCE_TTL_MS = 50_000;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;
/** Budget for connecting the listener and running LISTEN. */
const LISTEN_SETUP_TIMEOUT_MS = 5_000;
/** Budget for one NOTIFY before falling back to in-process delivery. */
const NOTIFY_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

interface PresenceEntry {
  name: string;
  lastSeen: number;
}

export class RealtimeBus {
  private readonly emitter = new EventEmitter();
  private listener: pg.Client | null = null;
  private connecting: Promise<void> | null = null;
  /** No new LISTEN attempt before this time (backoff after failures). */
  private retryAt = 0;
  private retryDelay = RETRY_MIN_MS;
  private readonly presence = new Map<string, Map<string, PresenceEntry>>();
  private lastPresenceSweep = 0;
  /** Open SSE connections per case/user in this process (multiple tabs). */
  private readonly connections = new Map<string, number>();

  constructor(
    private readonly createClient: () => pg.Client = () =>
      new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: LISTEN_SETUP_TIMEOUT_MS }),
    private readonly notify: (payload: string) => Promise<unknown> = (payload) =>
      prisma.$executeRaw`SELECT pg_notify(${CHANNEL}, ${payload})`,
    private readonly now: () => number = Date.now,
  ) {
    this.emitter.setMaxListeners(0);
  }

  async publish(event: CaseRealtimeEvent): Promise<void> {
    // NOTIFY reaches the other processes whether or not this one listens yet; only this
    // process's own subscribers depend on our LISTEN connection.
    const listening = this.listener !== null;
    if (!listening) {
      this.deliver(event);
      void this.ensureListening(); // in the background, never awaited by publishers
    }
    try {
      await withTimeout(this.notify(JSON.stringify(event)), NOTIFY_TIMEOUT_MS, "NOTIFY");
    } catch (error) {
      console.warn("[realtime] NOTIFY failed; delivered in-process only", error);
      if (listening) this.deliver(event);
    }
  }

  /** Convenience: tell viewers of a case that some data changed. */
  touch(caseRoomId: string, scopes: CaseScope[], actorId: string | null = null) {
    return this.publish({ type: "case.updated", caseRoomId, scopes, actorId });
  }

  subscribe(caseRoomId: string, handler: (event: CaseRealtimeEvent) => void): () => void {
    void this.ensureListening();
    this.emitter.on(caseRoomId, handler);
    return () => {
      this.emitter.off(caseRoomId, handler);
    };
  }

  presenceSnapshot(caseRoomId: string): Array<{ userId: string; name: string }> {
    this.sweepPresence(true);
    const entries = this.presence.get(caseRoomId);
    if (!entries) return [];
    return [...entries.entries()].map(([userId, entry]) => ({ userId, name: entry.name }));
  }

  /** Track SSE connections; returns true when this is the user's first connection. */
  connect(caseRoomId: string, userId: string): boolean {
    const key = `${caseRoomId}:${userId}`;
    const count = (this.connections.get(key) ?? 0) + 1;
    this.connections.set(key, count);
    return count === 1;
  }

  /** Returns true when the user has no remaining connections in this process. */
  disconnect(caseRoomId: string, userId: string): boolean {
    const key = `${caseRoomId}:${userId}`;
    const count = Math.max(0, (this.connections.get(key) ?? 1) - 1);
    if (count === 0) this.connections.delete(key);
    else this.connections.set(key, count);
    return count === 0;
  }

  /** Close the listener connection and stop reconnecting (shutdown, tests). */
  async close(): Promise<void> {
    this.retryAt = Number.POSITIVE_INFINITY;
    await this.whenSettled();
    const listener = this.listener;
    this.listener = null;
    await listener?.end().catch(() => undefined);
  }

  /** Resolves when the current listener setup attempt (if any) has finished (for tests). */
  whenSettled(): Promise<void> {
    return this.connecting ?? Promise.resolve();
  }

  /** Number of cases with tracked presence (for tests and diagnostics). */
  get presenceRooms(): number {
    return this.presence.size;
  }

  private deliver(event: CaseRealtimeEvent) {
    if (event.type === "presence") {
      const room = this.presence.get(event.caseRoomId) ?? new Map<string, PresenceEntry>();
      if (event.status === "online") room.set(event.userId, { name: event.name, lastSeen: this.now() });
      else room.delete(event.userId);
      if (room.size > 0) this.presence.set(event.caseRoomId, room);
      else this.presence.delete(event.caseRoomId);
      this.sweepPresence(false);
    }
    this.emitter.emit(event.caseRoomId, event);
  }

  /**
   * Drop presence entries whose heartbeat stopped (a process or connection died
   * without announcing offline) and rooms left empty. Runs at most once per TTL
   * unless forced.
   */
  private sweepPresence(force: boolean) {
    const now = this.now();
    if (!force && now - this.lastPresenceSweep < PRESENCE_TTL_MS) return;
    this.lastPresenceSweep = now;
    for (const [caseRoomId, room] of this.presence) {
      for (const [userId, entry] of room) if (now - entry.lastSeen >= PRESENCE_TTL_MS) room.delete(userId);
      if (room.size === 0) this.presence.delete(caseRoomId);
    }
  }

  private ensureListening(): Promise<void> {
    if (this.listener) return Promise.resolve();
    if (this.connecting) return this.connecting;
    if (this.now() < this.retryAt) return Promise.resolve();

    const client = this.createClient();
    const attempt = (async () => {
      client.on("notification", (message) => {
        if (message.channel !== CHANNEL || !message.payload) return;
        try {
          this.deliver(JSON.parse(message.payload) as CaseRealtimeEvent);
        } catch (error) {
          console.warn("[realtime] bad payload", error);
        }
      });
      const lost = () => {
        if (this.listener !== client) return;
        this.listener = null;
        this.scheduleRetry();
      };
      client.on("error", (error) => {
        console.error("[realtime] listener connection error", error.message);
        lost();
        client.end().catch(() => undefined);
      });
      client.on("end", lost);
      await withTimeout(
        (async () => {
          await client.connect();
          await client.query(`LISTEN ${CHANNEL}`);
        })(),
        LISTEN_SETUP_TIMEOUT_MS,
        "LISTEN setup",
      );
      this.listener = client;
      this.retryDelay = RETRY_MIN_MS;
      this.retryAt = 0;
      // Events from other instances were not received before this point: make every viewer reload.
      this.resyncAll();
    })()
      .catch((error: unknown) => {
        console.error("[realtime] could not start LISTEN; using in-process delivery", error);
        // The attempt owns its client: close it whether connect or LISTEN failed.
        client.end().catch(() => undefined);
        this.scheduleRetry();
      })
      .finally(() => {
        if (this.connecting === attempt) this.connecting = null;
      });
    this.connecting = attempt;
    return attempt;
  }

  private scheduleRetry() {
    this.retryAt = this.now() + this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
  }

  private resyncAll() {
    for (const name of this.emitter.eventNames()) {
      if (typeof name === "string") this.emitter.emit(name, { type: "resync", caseRoomId: name } satisfies CaseRealtimeEvent);
    }
  }
}

const globalForBus = globalThis as unknown as { __ccrRealtimeBus?: RealtimeBus };
export const realtime: RealtimeBus = (globalForBus.__ccrRealtimeBus ??= new RealtimeBus());
