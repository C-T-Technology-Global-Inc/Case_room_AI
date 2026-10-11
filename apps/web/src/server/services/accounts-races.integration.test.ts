import * as db from "@ccr/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCareTeam, resetDatabase, sessionUserFor } from "@/test/integration/fixtures";
import { memoryOutbox } from "../email";
import { ConflictError, ForbiddenError, ValidationError } from "../errors";
import { changePassword, completeSignup, renameOrganization, requestPasswordReset, requestSignup, resetPassword, updateProfile } from "./accounts";
import { createAdditionalOrganization } from "./organizations";
import { deactivateMember, inviteMember, joinOrganization } from "./team";

/**
 * Interleavings found in Codex round 6. `lockRow` and `hashPassword` are
 * wrapped only to pause at chosen points; the real locks, transactions and
 * hashing still run.
 */
vi.mock("@ccr/database", async (importOriginal) => {
  const actual = await importOriginal<typeof db>();
  return { ...actual, hashPassword: vi.fn(actual.hashPassword), lockRow: vi.fn(actual.lockRow) };
});
vi.mock("@/server/realtime/bus", () => ({ realtime: { touch: vi.fn(async () => {}), publish: vi.fn(async () => {}) } }));

let actual: typeof db;
type Team = Awaited<ReturnType<typeof createCareTeam>>;
let team: Team;

beforeEach(async () => {
  actual = await vi.importActual<typeof db>("@ccr/database");
  vi.mocked(db.lockRow).mockImplementation(actual.lockRow);
  vi.mocked(db.hashPassword).mockImplementation(actual.hashPassword);
  vi.mocked(db.hashPassword).mockClear();
  await resetDatabase();
  memoryOutbox().length = 0;
  team = await createCareTeam("Races");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Pause the next `lockRow` on `table`: resolves `reached` when it is called, waits for `release`. */
function pauseNextLock(table: string) {
  const reached = latch();
  const release = latch();
  let armed = true;
  vi.mocked(db.lockRow).mockImplementation(async (...args) => {
    if (armed && args[1] === table) {
      armed = false;
      reached.resolve();
      await release.promise;
    }
    return actual.lockRow(...args);
  });
  return { reached: reached.promise, release: release.resolve };
}

function lastLinkToken(path: string): string {
  const match = memoryOutbox().at(-1)!.text.match(new RegExp(`${path}/([A-Za-z0-9_-]+)`));
  return match![1]!;
}

async function setPasswordOf(memberId: string, password: string) {
  const member = await db.prisma.user.findUniqueOrThrow({ where: { id: memberId } });
  await db.prisma.identity.update({ where: { id: member.identityId }, data: { passwordHash: await actual.hashPassword(password) } });
  return sessionUserFor(memberId);
}

describe("password writes that interleave", () => {
  it("refuses a password change verified before a reset that completed meanwhile (finding 1)", async () => {
    const nurse = await setPasswordOf(team.nurse.id, "old-password");
    await requestPasswordReset({ email: nurse.email });
    const token = lastLinkToken("/reset-password");

    // The change has verified the old password and is hashing the new one.
    const hashing = latch();
    const resume = latch();
    vi.mocked(db.hashPassword).mockImplementationOnce(async (password) => {
      hashing.resolve();
      await resume.promise;
      return actual.hashPassword(password);
    });
    const change = changePassword(nurse, { currentPassword: "old-password", newPassword: "stale-session-password" });
    await hashing.promise;
    await resetPassword({ token, password: "owner-recovery-password" });
    resume.resolve();

    await expect(change).rejects.toBeInstanceOf(ConflictError);
    const identity = await db.prisma.identity.findUniqueOrThrow({ where: { id: nurse.identityId } });
    expect(await actual.verifyPassword("owner-recovery-password", identity.passwordHash)).toBe(true);
    expect(identity.sessionVersion).toBe(nurse.sessionVersion + 1);
  });

  it("does not deadlock when two different reset links of one account are used at once (finding 3)", async () => {
    await requestPasswordReset({ email: team.nurse.email });
    const first = lastLinkToken("/reset-password");
    await requestPasswordReset({ email: team.nurse.email });
    const second = lastLinkToken("/reset-password");

    // The first reset is held just before it locks the account; the second runs to completion.
    const held = pauseNextLock("Identity");
    const slow = resetPassword({ token: first, password: "first-new-password" });
    await held.reached;
    await resetPassword({ token: second, password: "second-new-password" });
    held.release();

    // The second reset voided the first link: a clear validation error, not a database deadlock.
    await expect(slow).rejects.toBeInstanceOf(ValidationError);
    const identity = await db.prisma.identity.findUniqueOrThrow({ where: { id: team.nurse.identityId } });
    expect(await actual.verifyPassword("second-new-password", identity.passwordHash)).toBe(true);
  });

  it("never hashes a password for an unknown, used or expired link (finding 4)", async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(resetPassword({ token: `not-a-real-token-${attempt}-abcdefghij`, password: "whatever-password" })).rejects.toBeInstanceOf(ValidationError);
      await expect(completeSignup({ token: `not-a-real-token-${attempt}-abcdefghij`, password: "whatever-password" })).rejects.toBeInstanceOf(ValidationError);
    }
    expect(db.hashPassword).not.toHaveBeenCalled();
  });

  it("still uses a valid signup link normally", async () => {
    await requestSignup({ organizationName: "Race Clinic", name: "Dr. Race", email: "race@hospital.test" });
    await expect(completeSignup({ token: lastLinkToken("/signup/confirm"), password: "race-password" })).resolves.toMatchObject({ role: "ORG_ADMIN" });
  });
});

describe("admin requests queued behind a deactivation (finding 2)", () => {
  it("does not create an invitation for an admin deactivated while the request waited for the lock", async () => {
    const held = pauseNextLock("Organization");
    const invite = inviteMember(team.adminB, { organizationId: team.organization.id, email: "late@hospital.test", role: "ORG_ADMIN" });
    await held.reached;
    await deactivateMember(team.adminA, team.adminB.id);
    held.release();
    await expect(invite).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.prisma.invitation.count()).toBe(0);
  });

  it("does not rename the organization for an admin deactivated while the request waited for the lock", async () => {
    const held = pauseNextLock("Organization");
    const rename = renameOrganization(team.adminB, { organizationId: team.organization.id, name: "Renamed Too Late" });
    await held.reached;
    await deactivateMember(team.adminA, team.adminB.id);
    held.release();
    await expect(rename).rejects.toBeInstanceOf(ForbiddenError);
    expect((await db.prisma.organization.findUniqueOrThrow({ where: { id: team.organization.id } })).name).toBe(team.organization.name);
  });
});

describe("new memberships copy the current profile (finding 6)", () => {
  it("joining by invitation uses the name saved while the join waited", async () => {
    const other = await createCareTeam("Other");
    const invitation = await inviteMember(other.adminA, { organizationId: other.organization.id, email: team.nurse.email, role: "NURSE" });
    const held = pauseNextLock("Identity");
    const join = joinOrganization(team.nurse.identityId, invitation.token);
    await held.reached;
    await updateProfile(team.nurse, { organizationId: team.organization.id, name: "New Global Name", title: "", specialty: "" });
    held.release();
    expect((await join).name).toBe("New Global Name");
  });

  it("creating another organization uses the name saved while it waited", async () => {
    const held = pauseNextLock("Identity");
    const created = createAdditionalOrganization(team.nurse, { name: "Second Synthetic Clinic" });
    await held.reached;
    await updateProfile(team.nurse, { organizationId: team.organization.id, name: "New Global Name", title: "", specialty: "" });
    held.release();
    const organization = await created;
    const member = await db.prisma.user.findFirstOrThrow({ where: { organizationId: organization.id } });
    expect(member.name).toBe("New Global Name");
  });
});
