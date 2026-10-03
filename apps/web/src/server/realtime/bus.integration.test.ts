import type { CaseRealtimeEvent } from "@ccr/types";
import { afterAll, describe, expect, it } from "vitest";
import { RealtimeBus } from "./bus";

/**
 * Two buses stand in for two app processes: each opens its own LISTEN
 * connection to the test database, and NOTIFY carries events between them.
 */
const waitFor = async (condition: () => boolean, ms = 5_000) => {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const buses: RealtimeBus[] = [];
afterAll(async () => {
  await Promise.all(buses.map((bus) => bus.close()));
});

describe("RealtimeBus over PostgreSQL LISTEN/NOTIFY", () => {
  it("delivers an event published in one process to subscribers of another", async () => {
    const a = new RealtimeBus();
    const b = new RealtimeBus();
    buses.push(a, b);
    const receivedByA: CaseRealtimeEvent[] = [];
    a.subscribe("case-x", (event) => receivedByA.push(event));
    b.subscribe("case-x", () => {});
    await Promise.all([a.whenSettled(), b.whenSettled()]);

    await b.touch("case-x", ["messages"]);
    await waitFor(() => receivedByA.some((e) => e.type === "case.updated"));
    // The first LISTEN also announced a resync to A's subscriber.
    expect(receivedByA[0]).toEqual({ type: "resync", caseRoomId: "case-x" });
    expect(receivedByA.at(-1)).toMatchObject({ type: "case.updated", scopes: ["messages"] });
  });
});

describe("a process that has not started listening yet (round 3 finding 3)", () => {
  it("still notifies the other processes about its first event", async () => {
    const listener = new RealtimeBus();
    const cold = new RealtimeBus();
    buses.push(listener, cold);
    const received: CaseRealtimeEvent[] = [];
    listener.subscribe("case-cold", (event) => received.push(event));
    await listener.whenSettled();

    await cold.touch("case-cold", ["messages"]); // cold has no listener and no subscribers
    await waitFor(() => received.some((e) => e.type === "case.updated"));
    expect(received.filter((e) => e.type === "case.updated")).toHaveLength(1);
  });
});
