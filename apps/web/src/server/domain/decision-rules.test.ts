import { describe, expect, it } from "vitest";
import { can, isClinicalReviewer, ROLE_PERMISSIONS } from "../authz/permissions";
import { deriveDecisionStatus } from "./decision-rules";
import { parseMentions } from "@/lib/mentions";
import { describeActivity, shortName } from "@/lib/activity";

describe("deriveDecisionStatus (human-in-the-loop)", () => {
  it("cannot approve a decision without reviewers", () => {
    expect(deriveDecisionStatus([])).toBe("PROPOSED");
  });
  it("stays under review until every reviewer approves", () => {
    expect(deriveDecisionStatus(["APPROVED", "PENDING"])).toBe("UNDER_REVIEW");
    expect(deriveDecisionStatus(["APPROVED", "NEEDS_CHANGES"])).toBe("UNDER_REVIEW");
    expect(deriveDecisionStatus(["APPROVED", "APPROVED"])).toBe("APPROVED");
  });
  it("is rejected by any single rejection", () => {
    expect(deriveDecisionStatus(["APPROVED", "REJECTED", "PENDING"])).toBe("REJECTED");
  });
  it("is proposed while nobody has responded", () => {
    expect(deriveDecisionStatus(["PENDING", "PENDING"])).toBe("PROPOSED");
  });
});

describe("role permissions", () => {
  it("lets only clinicians review decisions and approve briefs", () => {
    expect(can({ role: "DOCTOR" }, "decision.review")).toBe(true);
    expect(can({ role: "SPECIALIST" }, "brief.approve")).toBe(true);
    expect(can({ role: "NURSE" }, "decision.review")).toBe(false);
    expect(can({ role: "ORG_ADMIN" }, "decision.review")).toBe(false);
    expect(can({ role: "CARE_COORDINATOR" }, "brief.approve")).toBe(false);
  });
  it("lets nurses run and approve handoffs and manage tasks", () => {
    expect(can({ role: "NURSE" }, "handoff.approve")).toBe(true);
    expect(can({ role: "NURSE" }, "task.manage")).toBe(true);
    expect(can({ role: "NURSE" }, "ai.ask")).toBe(true);
  });
  it("restricts organization management to admins", () => {
    const managers = Object.entries(ROLE_PERMISSIONS).filter(([, permissions]) => permissions.includes("org.manage"));
    expect(managers.map(([role]) => role)).toEqual(["ORG_ADMIN"]);
    expect(isClinicalReviewer("DOCTOR")).toBe(true);
    expect(isClinicalReviewer("ORG_ADMIN")).toBe(false);
  });
});

describe("mentions", () => {
  const members = [
    { id: "u1", handle: "DrSmith" },
    { id: "u2", handle: "RachelAdams" },
  ];
  it("detects @AI and colleague handles case-insensitively", () => {
    expect(parseMentions("@ai compare this with the CT. @drsmith thoughts?", members)).toEqual({ mentionsAI: true, userIds: ["u1"] });
  });
  it("ignores unknown handles and email addresses", () => {
    expect(parseMentions("ping @Nobody at someone@example.com", members)).toEqual({ mentionsAI: false, userIds: [] });
  });
});

describe("activity descriptions", () => {
  it("renders human-readable sentences", () => {
    expect(shortName("Dr. Minh Nguyen")).toBe("Dr. Nguyen");
    expect(
      describeActivity({ action: "document.uploaded", actorType: "USER", metadata: { title: "Path", documentType: "PATHOLOGY_REPORT" }, user: { name: "Dr. Minh Nguyen" } }).text,
    ).toBe("Dr. Nguyen uploaded a pathology report “Path”.");
    expect(
      describeActivity({ action: "decision.approved", actorType: "USER", metadata: { number: 12, title: "Treatment Plan" }, user: { name: "Dr. Emily Smith" } }).text,
    ).toBe("Dr. Smith approved Decision #12 (Treatment Plan).");
  });
});
