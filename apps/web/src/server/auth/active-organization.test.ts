import { describe, expect, it } from "vitest";
import { pickActiveMembership } from "./active-organization";

const day = (n: number) => new Date(Date.UTC(2026, 9, n));

describe("pickActiveMembership", () => {
  const memberships = [
    { organizationId: "riverside", lastLoginAt: day(1), createdAt: day(1) },
    { organizationId: "lakeside", lastLoginAt: day(5), createdAt: day(2) },
    { organizationId: "northside", lastLoginAt: null, createdAt: day(3) },
  ];

  it("uses the requested organization when the person belongs to it", () => {
    expect(pickActiveMembership(memberships, "riverside")?.organizationId).toBe("riverside");
  });

  it("ignores a requested organization the person does not belong to", () => {
    expect(pickActiveMembership(memberships, "someone-elses-org")?.organizationId).toBe("lakeside");
  });

  it("falls back to the most recently used organization", () => {
    expect(pickActiveMembership(memberships, undefined)?.organizationId).toBe("lakeside");
  });

  it("returns null without memberships", () => {
    expect(pickActiveMembership([], "riverside")).toBeNull();
  });
});
