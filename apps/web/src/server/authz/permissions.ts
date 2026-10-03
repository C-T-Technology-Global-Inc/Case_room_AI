import type { UserRole } from "@ccr/types";
import { ForbiddenError } from "../errors";

/**
 * Role-based permissions. Clinical sign-off (decisions, briefs, handoffs) is
 * restricted to clinical roles; no permission exists that lets the AI approve
 * anything, because approvals can only be created by an authenticated human.
 */
export const PERMISSIONS = [
  "org.manage", // invite users, change roles
  "org.audit", // organization-wide audit log
  "case.create",
  "case.viewAll", // see every case room in the organization
  "case.manage", // change status, invite specialists
  "document.upload",
  "timeline.edit",
  "message.post",
  "ai.ask",
  "brief.generate", // case summary, tumor board brief
  "brief.approve", // mark AI summary reviewed, approve/share tumor board brief
  "handoff.generate",
  "handoff.approve",
  "decision.create",
  "decision.review", // approve / reject / request changes
  "task.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const CLINICIAN: Permission[] = [
  "case.create",
  "case.manage",
  "document.upload",
  "timeline.edit",
  "message.post",
  "ai.ask",
  "brief.generate",
  "brief.approve",
  "handoff.generate",
  "handoff.approve",
  "decision.create",
  "decision.review",
  "task.manage",
];

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  ORG_ADMIN: [
    "org.manage",
    "org.audit",
    "case.create",
    "case.viewAll",
    "case.manage",
    "document.upload",
    "message.post",
    "ai.ask",
    "brief.generate",
    "handoff.generate",
    "task.manage",
  ],
  DOCTOR: CLINICIAN,
  SPECIALIST: CLINICIAN,
  NURSE: ["document.upload", "timeline.edit", "message.post", "ai.ask", "handoff.generate", "handoff.approve", "task.manage"],
  CARE_COORDINATOR: ["case.create", "case.manage", "document.upload", "message.post", "ai.ask", "handoff.generate", "task.manage"],
};

export function can(user: { role: UserRole }, permission: Permission): boolean {
  return ROLE_PERMISSIONS[user.role].includes(permission);
}

export function assertCan(user: { role: UserRole }, permission: Permission, message?: string): void {
  if (!can(user, permission)) throw new ForbiddenError(message);
}

/** Roles that may be asked to review a clinical decision. */
export function isClinicalReviewer(role: UserRole): boolean {
  return ROLE_PERMISSIONS[role].includes("decision.review");
}
