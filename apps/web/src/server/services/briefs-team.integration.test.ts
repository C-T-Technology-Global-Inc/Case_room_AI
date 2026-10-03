import { prisma, type Prisma } from "@ccr/database";
import type { SectionsContent } from "@ccr/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCareTeam, resetDatabase, settle } from "@/test/integration/fixtures";
import { ConflictError } from "../errors";
import { approveBrief, updateBriefSections } from "./briefs";
import { acceptInvitation, changeMemberRole, inviteMember, revokeInvitation } from "./team";

vi.mock("@/server/realtime/bus", () => ({ realtime: { touch: vi.fn(async () => {}), publish: vi.fn(async () => {}) } }));

type Team = Awaited<ReturnType<typeof createCareTeam>>;
let team: Team;

beforeEach(async () => {
  await resetDatabase();
  team = await createCareTeam();
});

async function createTumorBoardBrief() {
  const content: SectionsContent = {
    kind: "sections",
    sections: [{ key: "caseSummary", title: "Case summary", body: "Original synthetic summary.", sources: [] }],
    limitations: "Synthetic test brief.",
  };
  return prisma.caseBrief.create({
    data: { caseRoomId: team.caseRoom.id, type: "TUMOR_BOARD", title: "Tumor board brief", content: content as Prisma.InputJsonValue },
  });
}

const edit = (body: string, expectedVersion: number) => ({ sections: [{ key: "caseSummary", body }], expectedVersion });

describe("brief sign-off is bound to a version (finding 4)", () => {
  it("refuses to approve a version the approver did not read", async () => {
    const brief = await createTumorBoardBrief();
    await updateBriefSections(team.proposer, brief.id, edit("Edited by a colleague.", 1));
    await expect(approveBrief(team.reviewerA, brief.id, { expectedVersion: 1 })).rejects.toBeInstanceOf(ConflictError);
    const stored = await prisma.caseBrief.findUniqueOrThrow({ where: { id: brief.id } });
    expect(stored.status).toBe("DRAFT");
    expect(stored.version).toBe(2);
  });

  it("keeps approval and content consistent when an edit races an approval", async () => {
    for (let round = 0; round < 5; round++) {
      const brief = await createTumorBoardBrief();
      await settle(
        () => approveBrief(team.reviewerA, brief.id, { expectedVersion: 1 }),
        () => updateBriefSections(team.proposer, brief.id, edit(`Concurrent edit ${round}.`, 1)),
      );
      const stored = await prisma.caseBrief.findUniqueOrThrow({ where: { id: brief.id } });
      const approvals = await prisma.auditEvent.findMany({ where: { resourceId: brief.id, action: "brief.approved" } });
      if (stored.status === "APPROVED") {
        // Approved content is exactly the version the approver read.
        expect(stored.version).toBe(1);
        expect(approvals.map((a) => (a.metadata as { version: number }).version)).toEqual([1]);
      } else {
        // The edit landed after (or instead of) the approval: draft again, approval cleared.
        expect(stored.version).toBe(2);
        expect(stored.approvedById).toBeNull();
      }
    }
  });
});

describe("organization admins (finding 17)", () => {
  it("keeps at least one admin when two admins demote themselves at once", async () => {
    const outcome = await settle(
      () => changeMemberRole(team.adminA, team.adminA.id, "DOCTOR"),
      () => changeMemberRole(team.adminB, team.adminB.id, "DOCTOR"),
    );
    expect(outcome.fulfilled).toBe(1);
    expect(await prisma.user.count({ where: { organizationId: team.organization.id, role: "ORG_ADMIN" } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "org.member_role_changed" } })).toBe(1);
  });

  it("refuses a role change by an admin who was demoted in the meantime", async () => {
    await changeMemberRole(team.adminA, team.adminB.id, "DOCTOR");
    // adminB's session object still says ORG_ADMIN; the database no longer does.
    await expect(changeMemberRole(team.adminB, team.nurse.id, "DOCTOR")).rejects.toThrow(/Only organization admins/);
  });
});

describe("invitations (finding 18)", () => {
  it("lets exactly one of accept and revoke win", async () => {
    for (let round = 0; round < 5; round++) {
      const invitation = await inviteMember(team.adminA, { organizationId: team.adminA.organizationId, email: `race${round}@test.invalid`, role: "ORG_ADMIN" });
      const outcome = await settle(
        () => acceptInvitation({ token: invitation.token, name: "Invited Admin", password: "synthetic-password" }),
        () => revokeInvitation(team.adminA, invitation.id),
      );
      expect(outcome.fulfilled).toBe(1);
      const stored = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
      const created = await prisma.user.count({ where: { email: invitation.email } });
      if (stored.status === "REVOKED") expect(created).toBe(0);
      else {
        expect(stored.status).toBe("ACCEPTED");
        expect(created).toBe(1);
      }
    }
  });

  it("does not create two pending invitations for the same email", async () => {
    const outcome = await settle(
      () => inviteMember(team.adminA, { organizationId: team.adminA.organizationId, email: "twice@test.invalid", role: "NURSE" }),
      () => inviteMember(team.adminB, { organizationId: team.adminB.organizationId, email: "twice@test.invalid", role: "NURSE" }),
    );
    expect(outcome.fulfilled).toBe(1);
    expect(await prisma.invitation.count({ where: { email: "twice@test.invalid", status: "PENDING" } })).toBe(1);
  });
});
