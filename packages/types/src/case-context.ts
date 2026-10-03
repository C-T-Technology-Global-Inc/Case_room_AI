import type { CaseMemory } from "./memory";
import type {
  ApprovalStatus,
  CaseSpecialty,
  CaseStatus,
  DecisionStatus,
  DocumentType,
  MessageType,
  PatientSex,
  PatientStatus,
  TaskPriority,
  TaskStatus,
  TimelineEventType,
  UserRole,
} from "./enums";

/**
 * The complete, authorized context of one patient case, as handed to the AI
 * layer. Built by the application from the database after access checks; the
 * AI package never queries the database itself.
 *
 * Dates are ISO strings (YYYY-MM-DD for clinical dates, full ISO for timestamps).
 */
export interface CaseContext {
  patient: ContextPatient;
  caseRoom: ContextCaseRoom;
  documents: ContextDocument[];
  timeline: ContextTimelineEvent[];
  decisions: ContextDecision[];
  tasks: ContextTask[];
  /** Most recent discussion messages, oldest first. */
  messages: ContextMessage[];
  memory: CaseMemory | null;
  team: ContextTeamMember[];
  /** The clinician on whose behalf the AI is acting. */
  requester: ContextRequester | null;
  /** ISO timestamp of "now", so outputs are reproducible in tests. */
  now: string;
}

export interface ContextPatient {
  id: string;
  displayName: string;
  firstName: string;
  lastName: string;
  age: number;
  sex: PatientSex;
  dateOfBirth: string;
  mrn: string;
  primaryDiagnosis: string;
  status: PatientStatus;
}

export interface ContextCaseRoom {
  id: string;
  title: string;
  specialty: CaseSpecialty;
  status: CaseStatus;
}

export interface ContextDocument {
  id: string;
  type: DocumentType;
  title: string;
  date: string;
  text: string;
  uploadedBy: string;
}

export interface ContextTimelineEvent {
  id: string;
  date: string;
  eventType: TimelineEventType;
  title: string;
  description: string;
  sourceDocumentId: string | null;
  createdByAI: boolean;
}

export interface ContextDecision {
  id: string;
  number: number;
  title: string;
  description: string;
  rationale: string;
  status: DecisionStatus;
  proposedBy: string;
  createdAt: string;
  finalizedAt: string | null;
  sourceDocumentIds: string[];
  approvals: Array<{
    reviewer: string;
    specialty: string | null;
    status: ApprovalStatus;
    comment: string | null;
  }>;
}

export interface ContextTask {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: string | null;
  dueDate: string | null;
}

export interface ContextMessage {
  id: string;
  type: MessageType;
  author: string;
  authorSpecialty: string | null;
  content: string;
  createdAt: string;
}

export interface ContextTeamMember {
  id: string;
  name: string;
  role: UserRole;
  specialty: string | null;
  handle: string;
}

export interface ContextRequester {
  id: string;
  name: string;
  role: UserRole;
  specialty: string | null;
}
