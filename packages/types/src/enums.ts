/**
 * Domain enums shared by every layer. The string values mirror the Prisma
 * enums in `@ccr/database` exactly, so Prisma values are assignable to these
 * types without mapping. The AI package depends only on these, never on Prisma.
 */

export const USER_ROLES = ["ORG_ADMIN", "DOCTOR", "SPECIALIST", "NURSE", "CARE_COORDINATOR"] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  ORG_ADMIN: "Organization Admin",
  DOCTOR: "Doctor",
  SPECIALIST: "Specialist",
  NURSE: "Nurse",
  CARE_COORDINATOR: "Care Coordinator",
};

export const PATIENT_SEXES = ["MALE", "FEMALE", "OTHER", "UNKNOWN"] as const;
export type PatientSex = (typeof PATIENT_SEXES)[number];
export const PATIENT_SEX_LABELS: Record<PatientSex, string> = {
  MALE: "Male",
  FEMALE: "Female",
  OTHER: "Other",
  UNKNOWN: "Unknown",
};

export const PATIENT_STATUSES = ["ACTIVE", "IN_TREATMENT", "SURVEILLANCE", "DISCHARGED"] as const;
export type PatientStatus = (typeof PATIENT_STATUSES)[number];
export const PATIENT_STATUS_LABELS: Record<PatientStatus, string> = {
  ACTIVE: "Active",
  IN_TREATMENT: "In treatment",
  SURVEILLANCE: "Surveillance",
  DISCHARGED: "Discharged",
};

export const CASE_SPECIALTIES = ["ONCOLOGY", "CARDIOLOGY", "CRITICAL_CARE", "EMERGENCY", "GENERAL"] as const;
export type CaseSpecialty = (typeof CASE_SPECIALTIES)[number];
export const CASE_SPECIALTY_LABELS: Record<CaseSpecialty, string> = {
  ONCOLOGY: "Oncology · Tumor Board",
  CARDIOLOGY: "Cardiology",
  CRITICAL_CARE: "Critical Care",
  EMERGENCY: "Emergency Medicine",
  GENERAL: "General Medicine",
};

export const CASE_STATUSES = ["OPEN", "REVIEWING", "DECISION_PENDING", "CLOSED"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  OPEN: "Open",
  REVIEWING: "Reviewing",
  DECISION_PENDING: "Decision pending",
  CLOSED: "Closed",
};

export const DOCUMENT_TYPES = [
  "CLINICAL_NOTE",
  "LAB_RESULT",
  "IMAGING_REPORT",
  "PATHOLOGY_REPORT",
  "DISCHARGE_SUMMARY",
  "OTHER",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  CLINICAL_NOTE: "Clinical note",
  LAB_RESULT: "Lab result",
  IMAGING_REPORT: "Imaging report",
  PATHOLOGY_REPORT: "Pathology report",
  DISCHARGE_SUMMARY: "Discharge summary",
  OTHER: "Other",
};

export const PROCESSING_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export const TIMELINE_EVENT_TYPES = [
  "IMAGING",
  "LAB",
  "PROCEDURE",
  "PATHOLOGY",
  "CONSULTATION",
  "ADMISSION",
  "TREATMENT",
  "DECISION",
  "NOTE",
  "DISCHARGE",
  "OTHER",
] as const;
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];
export const TIMELINE_EVENT_TYPE_LABELS: Record<TimelineEventType, string> = {
  IMAGING: "Imaging",
  LAB: "Lab",
  PROCEDURE: "Procedure",
  PATHOLOGY: "Pathology",
  CONSULTATION: "Consultation",
  ADMISSION: "Admission",
  TREATMENT: "Treatment",
  DECISION: "Decision",
  NOTE: "Note",
  DISCHARGE: "Discharge",
  OTHER: "Other",
};

export const MESSAGE_TYPES = ["USER", "AI", "SYSTEM"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const DECISION_STATUSES = ["PROPOSED", "UNDER_REVIEW", "APPROVED", "REJECTED"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];
export const DECISION_STATUS_LABELS: Record<DecisionStatus, string> = {
  PROPOSED: "Proposed",
  UNDER_REVIEW: "Under review",
  APPROVED: "Human approved",
  REJECTED: "Rejected",
};

export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "NEEDS_CHANGES"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  NEEDS_CHANGES: "Changes requested",
};

export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "DONE"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done",
};

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export const BRIEF_TYPES = ["CASE_SUMMARY", "TUMOR_BOARD", "HANDOFF"] as const;
export type BriefType = (typeof BRIEF_TYPES)[number];
export const BRIEF_TYPE_LABELS: Record<BriefType, string> = {
  CASE_SUMMARY: "Case summary",
  TUMOR_BOARD: "Tumor board brief",
  HANDOFF: "Patient handoff",
};

export const BRIEF_STATUSES = ["DRAFT", "APPROVED"] as const;
export type BriefStatus = (typeof BRIEF_STATUSES)[number];

export const ACTOR_TYPES = ["USER", "AI", "SYSTEM"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];
