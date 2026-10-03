import { EventEmitter } from "node:events";
import type { CaseRealtimeEvent } from "@ccr/types";
import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { PRESENCE_TTL_MS, RealtimeBus } from "./bus";

/** Stand-in for a pg.Client whose connect/LISTEN outcome each test controls. */
class FakeClient extends EventEmitter {
  ended = false;
  constructor(private readonly behaviour: { connect?: "ok" | "fail" | "hang"; listen?: "ok" | "fail" }) {
    super();
  }
  async connect() {
    if (this.behaviour.connect === "fail") throw new Error("connect refused");
    if (this.behaviour.connect === "hang") await new Promise(() => {});
  }
  async query() {
    if (this.behaviour.listen === "fail") throw new Error("LISTEN not supported by pooler");
  }
  async end() {
    this.ended = true;
  }
}

function busWith(behaviours: Array<ConstructorParameters<typeof FakeClient>[0]>, clock: { now: number }) {
  const clients: FakeClient[] = [];
  const bus = new RealtimeBus(
    () => {
      const client = new FakeClient(behaviours[Math.min(clients.length, behaviours.length - 1)]!);
      clients.push(client);
      return client as unknown as pg.Client;
    },
    vi.fn(async () => {}),
    () => clock.now,
  );
  return { bus, clients };
}

const touch = (bus: RealtimeBus) => bus.touch("case-1", ["messages"]);

describe("RealtimeBus listener setup (finding 16)", () => {
  it("closes the client when LISTEN fails and backs off instead of reconnecting on every event", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const clock = { now: 0 };
    const { bus, clients } = busWith([{ listen: "fail" }], clock);
    await touch(bus);
    await bus.whenSettled();
    await touch(bus);
    await touch(bus);
    await bus.whenSettled();
    expect(clients).toHaveLength(1);
    expect(clients[0]!.ended).toBe(true);

    clock.now += 1_000;
    await touch(bus);
    await bus.whenSettled();
    expect(clients).toHaveLength(2);
    expect(clients.every((c) => c.ended)).toBe(true);
  });

  it("still delivers in-process while LISTEN is unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { bus } = busWith([{ connect: "fail" }], { now: 0 });
    const received: CaseRealtimeEvent[] = [];
    bus.subscribe("case-1", (event) => received.push(event));
    await touch(bus);
    expect(received.map((e) => e.type)).toContain("case.updated");
  });
});

describe("RealtimeBus recovery (finding 15, round 2 finding 8)", () => {
  it("tells subscribers to resync whenever LISTEN is established, including the first time", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const clock = { now: 0 };
    const { bus } = busWith([{ listen: "fail" }, { listen: "ok" }], clock);
    const received: CaseRealtimeEvent[] = [];
    bus.subscribe("case-1", (event) => received.push(event));
    await bus.whenSettled();
    expect(received.some((e) => e.type === "resync")).toBe(false);

    clock.now += 1_000;
    await touch(bus);
    await bus.whenSettled();
    expect(received.filter((e) => e.type === "resync")).toEqual([{ type: "resync", caseRoomId: "case-1" }]);
  });
});

describe("RealtimeBus with a hanging listener connection (round 2 finding 3)", () => {
  it("delivers in-process at once instead of waiting for the connection", async () => {
    const { bus } = busWith([{ connect: "hang" }], { now: 0 });
    const received: CaseRealtimeEvent[] = [];
    bus.subscribe("case-1", (event) => received.push(event));
    await touch(bus);
    expect(received.map((e) => e.type)).toEqual(["case.updated"]);
  });

  it("abandons and closes a setup that never completes", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { bus, clients } = busWith([{ connect: "hang" }], { now: 0 });
      bus.subscribe("case-1", () => {});
      await vi.advanceTimersByTimeAsync(5_000);
      await bus.whenSettled();
      expect(clients[0]!.ended).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("RealtimeBus presence (finding 19)", () => {
  it("drops entries whose heartbeat stopped and rooms left empty", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const clock = { now: 0 };
    const { bus } = busWith([{ connect: "fail" }], clock);
    await bus.publish({ type: "presence", caseRoomId: "case-1", userId: "u1", name: "Dr. A", status: "online" });
    await bus.publish({ type: "presence", caseRoomId: "case-2", userId: "u2", name: "Dr. B", status: "online" });
    await bus.publish({ type: "presence", caseRoomId: "case-2", userId: "u2", name: "Dr. B", status: "offline" });
    expect(bus.presenceRooms).toBe(1);
    expect(bus.presenceSnapshot("case-1")).toEqual([{ userId: "u1", name: "Dr. A" }]);

    clock.now += PRESENCE_TTL_MS + 1;
    expect(bus.presenceSnapshot("case-1")).toEqual([]);
    expect(bus.presenceRooms).toBe(0);
  });
});
