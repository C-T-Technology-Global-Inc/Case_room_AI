import type { ApprovalStatus, DecisionStatus } from "@ccr/types";

/**
 * Human-in-the-loop rules for clinical decisions.
 *
 * A decision can only become APPROVED (final) when it has at least one
 * requested human reviewer and every requested reviewer has approved it.
 * Nothing produced by the AI can create or change an approval.
 */
export function deriveDecisionStatus(approvals: readonly ApprovalStatus[]): DecisionStatus {
  if (approvals.length === 0) return "PROPOSED";
  if (approvals.includes("REJECTED")) return "REJECTED";
  if (approvals.every((status) => status === "APPROVED")) return "APPROVED";
  if (approvals.some((status) => status !== "PENDING")) return "UNDER_REVIEW";
  return "PROPOSED";
}

export function isFinal(status: DecisionStatus): boolean {
  return status === "APPROVED" || status === "REJECTED";
}

export type ReviewVerdict = Exclude<ApprovalStatus, "PENDING">;

export function reviewAction(verdict: ReviewVerdict) {
  switch (verdict) {
    case "APPROVED":
      return { audit: "decision.approved", verb: "approved" } as const;
    case "REJECTED":
      return { audit: "decision.rejected", verb: "rejected" } as const;
    case "NEEDS_CHANGES":
      return { audit: "decision.changes_requested", verb: "requested changes to" } as const;
  }
}
