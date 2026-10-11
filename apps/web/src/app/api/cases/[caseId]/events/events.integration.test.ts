import { prisma } from "@ccr/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/server/auth/memberships";
import { getSessionUser } from "@/server/auth/session";
import { changeMemberRole, deactivateMember } from "@/server/services/team";
import { createCareTeam, resetDatabase } from "@/test/integration/fixtures";
import { GET } from "./route";

vi.mock("@/server/auth/session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/server/realtime/bus", () => ({
  realtime: {
    connect: vi.fn(),
    disconnect: vi.fn(() => false),
    subscribe: vi.fn(() => () => undefined),
    publish: vi.fn(async () => {}),
    touch: vi.fn(async () => {}),
    presenceSnapshot: vi.fn(() => []),
  },
}));

type Team = Awaited<ReturnType<typeof createCareTeam>>;
let team: Team;
const open: AbortController[] = [];

beforeEach(async () => {
  await resetDatabase();
  team = await createCareTeam("Live");
  vi.stubEnv("REALTIME_HEARTBEAT_MS", "100");
});

afterEach(() => {
  for (const controller of open.splice(0)) controller.abort();
  vi.unstubAllEnvs();
});

/** Open the live stream as `user`; `until` reads until the text matches or the stream ends. */
async function connect(user: SessionUser) {
  vi.mocked(getSessionUser).mockResolvedValue(user);
  const controller = new AbortController();
  open.push(controller);
  const response = await GET(new Request(`http://localhost/api/cases/${team.caseRoom.id}/events`, { signal: controller.signal }), {
    params: Promise.resolve({ caseId: team.caseRoom.id }),
  });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let ended = false;
  const until = async (pattern: RegExp, timeoutMs = 3_000) => {
    const deadline = Date.now() + timeoutMs;
    while (!pattern.test(text) && !ended && Date.now() < deadline) {
      const chunk = await Promise.race([reader.read(), new Promise<null>((resolve) => setTimeout(() => resolve(null), deadline - Date.now()))]);
      if (!chunk) break;
      if (chunk.done) ended = true;
      else text += decoder.decode(chunk.value, { stream: true });
    }
    return { text, ended };
  };
  return { until };
}

describe("live case stream re-checks access at every heartbeat", () => {
  it("stays open while access holds", async () => {
    const stream = await connect(team.nurse);
    const { text, ended } = await stream.until(/(: keep-alive[\s\S]*){3}/);
    expect(text).toContain("event: ready");
    expect(text.match(/: keep-alive/g)?.length).toBeGreaterThanOrEqual(3);
    expect(ended).toBe(false);
  });

  it("closes with a revoked event when the member is deactivated", async () => {
    const stream = await connect(team.nurse);
    await stream.until(/event: ready/);
    await deactivateMember(team.adminA, team.nurse.id);
    const { text, ended } = await stream.until(/event: revoked/);
    expect(text).toContain("event: revoked");
    expect((await stream.until(/never/, 1_000)).ended).toBe(true);
    expect(ended || text.includes("event: revoked")).toBe(true);
  });

  it("closes when the password changes (sessions issued before it are over)", async () => {
    const stream = await connect(team.nurse);
    await stream.until(/event: ready/);
    await prisma.identity.update({ where: { id: team.nurse.identityId }, data: { sessionVersion: { increment: 1 } } });
    expect((await stream.until(/event: revoked/)).text).toContain("event: revoked");
  });

  it("closes when a role change means the case is no longer visible", async () => {
    // Admins see every case of the organization without being on its care team.
    const stream = await connect(team.adminA);
    await stream.until(/event: ready/);
    await changeMemberRole(team.adminB, team.adminA.id, "NURSE");
    expect((await stream.until(/event: revoked/)).text).toContain("event: revoked");
  });
});
