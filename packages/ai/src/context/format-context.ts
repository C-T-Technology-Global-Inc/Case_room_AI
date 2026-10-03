import type { CaseContext, CaseMemory } from "@ccr/types";
import {
  APPROVAL_STATUS_LABELS,
  CASE_SPECIALTY_LABELS,
  CASE_STATUS_LABELS,
  DECISION_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  PATIENT_SEX_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TIMELINE_EVENT_TYPE_LABELS,
  USER_ROLE_LABELS,
} from "@ccr/types";
import { retrievePassages, totalDocumentChars } from "../retrieval/passages";
import type { SourceRegistry } from "./source-registry";

/**
 * Serializes an authorized CaseContext into prompt text. Every record carries
 * its citation key so the model can cite it. Output is split into blocks by
 * volatility so the most stable part (documents) can be prompt-cached.
 *
 * All user-controlled text passes through `safe()` / `attr()` so that a
 * document or message cannot close the data wrappers and continue as
 * free-standing text outside <case_record>.
 */

const RESERVED_TAGS = /<(\/?\s*)(case_record|case_state|recent_discussion|document|passage|question)\b/gi;

/** Neutralize the wrapper tags this module uses ("</document>" becomes "‹/document>"). */
export function safe(text: string): string {
  return text.replace(RESERVED_TAGS, "‹$1$2");
}

/**
 * A record value (name, title, diagnosis) repeated inside task instructions:
 * wrapper tags neutralized and JSON-quoted on one line, so it reads as a value
 * and cannot start new lines of instructions.
 */
export function quoted(text: string): string {
  return JSON.stringify(safe(text));
}

/** Escape a value placed inside a double-quoted attribute. */
export function attr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Above this many characters of document text, switch from full documents to retrieved passages. */
export const FULL_CONTEXT_CHAR_BUDGET = 150_000;

export interface CaseRecordBlocks {
  /** Patient header and documents (most stable, cacheable). */
  documents: string;
  /** Memory, timeline, decisions, tasks (changes as the team works). */
  state: string;
  /** Recent discussion (changes constantly). */
  discussion: string;
  mode: "full" | "retrieval";
}

export interface FormatOptions {
  /** Query used to retrieve passages when the case is too large for full context. */
  query?: string;
  /** Limit documents to these ids (e.g. the single document being processed). */
  onlyDocumentIds?: string[];
  includeDiscussion?: boolean;
}

export function formatCaseRecord(
  ctx: CaseContext,
  registry: SourceRegistry,
  options: FormatOptions = {},
): CaseRecordBlocks {
  const mode =
    !options.onlyDocumentIds && totalDocumentChars(ctx) > FULL_CONTEXT_CHAR_BUDGET && options.query
      ? "retrieval"
      : "full";

  return {
    documents: [
      "<case_record>",
      formatHeader(ctx),
      mode === "full" ? formatDocuments(ctx, registry, options.onlyDocumentIds) : formatPassages(ctx, registry, options.query ?? ""),
      "</case_record>",
    ].join("\n\n"),
    state: [
      "<case_state>",
      formatMemory(ctx.memory),
      formatTimeline(ctx, registry),
      formatDecisions(ctx, registry),
      formatTasks(ctx, registry),
      "</case_state>",
    ].join("\n\n"),
    discussion: options.includeDiscussion === false ? "" : formatDiscussion(ctx, registry),
    mode,
  };
}

function formatHeader(ctx: CaseContext): string {
  const { patient, caseRoom } = ctx;
  const team = ctx.team
    .map((member) => `${member.name} (${member.specialty ?? USER_ROLE_LABELS[member.role]})`)
    .join("; ");
  return [
    `PATIENT (synthetic demo patient): ${safe(patient.displayName)}, ${patient.age}-year-old ${PATIENT_SEX_LABELS[patient.sex].toLowerCase()}, DOB ${patient.dateOfBirth}, MRN ${safe(patient.mrn)}`,
    `PRIMARY DIAGNOSIS (as recorded at case creation): ${safe(patient.primaryDiagnosis)}`,
    `CASE ROOM: "${safe(caseRoom.title)}" | ${CASE_SPECIALTY_LABELS[caseRoom.specialty]} | status: ${CASE_STATUS_LABELS[caseRoom.status]}`,
    `CARE TEAM: ${safe(team) || "not recorded"}`,
    `TODAY: ${ctx.now.slice(0, 10)}`,
  ].join("\n");
}

function formatDocuments(ctx: CaseContext, registry: SourceRegistry, onlyIds?: string[]): string {
  const entries = registry
    .entries("document")
    .filter((entry) => !onlyIds || onlyIds.includes(entry.id));
  if (entries.length === 0) return "DOCUMENTS: none uploaded yet.";
  const docsById = new Map(ctx.documents.map((doc) => [doc.id, doc]));
  const parts = entries.map((entry) => {
    const doc = docsById.get(entry.id);
    if (!doc) return "";
    return [
      `<document key="${entry.key}" type="${DOCUMENT_TYPE_LABELS[doc.type]}" date="${attr(doc.date)}" title="${attr(doc.title)}" uploaded_by="${attr(doc.uploadedBy)}">`,
      safe(doc.text.trim()),
      "</document>",
    ].join("\n");
  });
  return `DOCUMENTS (cite as D#):\n${parts.join("\n\n")}`;
}

function formatPassages(ctx: CaseContext, registry: SourceRegistry, query: string): string {
  const index = registry
    .entries("document")
    .map((entry) => `[${entry.key}] ${entry.date} | ${entry.documentType ? DOCUMENT_TYPE_LABELS[entry.documentType] : ""} | ${safe(entry.label)}`)
    .join("\n");
  const passages = retrievePassages(ctx, query, 12).map(({ item }) => {
    const key = registry.keyFor(item.documentId) ?? "?";
    return `<passage key="${key}" part="${item.index + 1}/${item.total}" title="${attr(item.documentTitle)}" date="${attr(item.documentDate)}">\n${safe(item.text)}\n</passage>`;
  });
  return [
    `DOCUMENT INDEX (cite as D#). The case is large, so only the passages most relevant to the question are included below:`,
    index,
    `RELEVANT PASSAGES:\n${passages.join("\n\n") || "none matched"}`,
  ].join("\n\n");
}

function formatMemory(memory: CaseMemory | null): string {
  if (!memory) return "SHARED PATIENT MEMORY: not yet built.";
  const lines: string[] = ["SHARED PATIENT MEMORY (structured extract of the documents; cite the underlying documents, not the memory):"];
  if (memory.patientSummary) lines.push(`Summary: ${memory.patientSummary}`);
  if (memory.activeProblems.length) lines.push(`Active problems: ${memory.activeProblems.join("; ")}`);
  if (memory.diagnoses.length) lines.push(`Diagnoses: ${memory.diagnoses.map((d) => `${d.name}${d.detail ? ` (${d.detail})` : ""}`).join("; ")}`);
  if (memory.medications.length) lines.push(`Medications: ${memory.medications.map((m) => `${m.name}${m.detail ? ` ${m.detail}` : ""}`).join("; ")}`);
  if (memory.treatments.length) lines.push(`Treatments: ${memory.treatments.map((t) => `${t.name} [${t.status}]${t.detail ? ` ${t.detail}` : ""}`).join("; ")}`);
  if (memory.importantLabs.length) lines.push(`Labs: ${memory.importantLabs.slice(-15).map((l) => `${l.name} ${l.value} (${l.flag}, ${l.date ?? "undated"})`).join("; ")}`);
  if (memory.importantImaging.length) lines.push(`Imaging: ${memory.importantImaging.map((i) => `${i.study} ${i.date ?? ""}: ${i.finding}`).join("; ")}`);
  if (memory.pathology.length) lines.push(`Pathology: ${memory.pathology.map((p) => `${p.date ?? ""} ${p.finding}`).join("; ")}`);
  if (memory.openQuestions.length) lines.push(`Open questions: ${memory.openQuestions.join("; ")}`);
  return safe(lines.join("\n"));
}

function formatTimeline(ctx: CaseContext, registry: SourceRegistry): string {
  const entries = registry.entries("timeline");
  if (entries.length === 0) return "TIMELINE: empty.";
  const eventsById = new Map(ctx.timeline.map((event) => [event.id, event]));
  const lines = entries.map((entry) => {
    const event = eventsById.get(entry.id);
    if (!event) return "";
    const source = event.sourceDocumentId ? registry.keyFor(event.sourceDocumentId) : undefined;
    return `[${entry.key}] ${event.date} | ${TIMELINE_EVENT_TYPE_LABELS[event.eventType]} | ${safe(event.title)}: ${safe(event.description)}${source ? ` (source ${source})` : ""}`;
  });
  return `TIMELINE (cite as T#):\n${lines.join("\n")}`;
}

function formatDecisions(ctx: CaseContext, registry: SourceRegistry): string {
  if (ctx.decisions.length === 0) return "DECISIONS: none recorded.";
  const blocks = ctx.decisions.map((decision) => {
    const approvals = decision.approvals.length
      ? decision.approvals
          .map((a) => `${safe(a.reviewer)}${a.specialty ? ` (${safe(a.specialty)})` : ""}: ${APPROVAL_STATUS_LABELS[a.status]}${a.comment ? ` - "${safe(a.comment)}"` : ""}`)
          .join("; ")
      : "no reviewers assigned";
    const sources = decision.sourceDocumentIds
      .map((id) => registry.keyFor(id))
      .filter(Boolean)
      .join(", ");
    return [
      `[DEC${decision.number}] Decision #${decision.number}: ${safe(decision.title)} | status: ${DECISION_STATUS_LABELS[decision.status]} | proposed by ${safe(decision.proposedBy)} on ${decision.createdAt.slice(0, 10)}${decision.finalizedAt ? ` | finalized ${decision.finalizedAt.slice(0, 10)}` : ""}`,
      `  Description: ${safe(decision.description)}`,
      `  Rationale: ${safe(decision.rationale)}`,
      `  Reviews: ${approvals}`,
      sources ? `  Linked sources: ${sources}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });
  return `DECISIONS (cite as DEC#; only APPROVED decisions are final, and only humans approve):\n${blocks.join("\n")}`;
}

function formatTasks(ctx: CaseContext, registry: SourceRegistry): string {
  const entries = registry.entries("task");
  if (entries.length === 0) return "TASKS: none.";
  const tasksById = new Map(ctx.tasks.map((task) => [task.id, task]));
  const lines = entries.map((entry) => {
    const task = tasksById.get(entry.id);
    if (!task) return "";
    return `[${entry.key}] ${safe(task.title)} | ${TASK_STATUS_LABELS[task.status]} | ${TASK_PRIORITY_LABELS[task.priority]} priority | ${task.assignee ? `assigned to ${safe(task.assignee)}` : "unassigned"}${task.dueDate ? ` | due ${task.dueDate}` : ""}`;
  });
  return `TASKS (cite as TK#):\n${lines.join("\n")}`;
}

function formatDiscussion(ctx: CaseContext, registry: SourceRegistry): string {
  const entries = registry.entries("message");
  if (entries.length === 0) return "";
  const byId = new Map(ctx.messages.map((message) => [message.id, message]));
  const lines = entries.map((entry) => {
    const message = byId.get(entry.id);
    if (!message) return "";
    const who =
      message.type === "AI" ? "AI assistant" : message.type === "SYSTEM" ? "System" : `${message.author}${message.authorSpecialty ? ` (${message.authorSpecialty})` : ""}`;
    return `[${entry.key}] ${message.createdAt.slice(0, 16).replace("T", " ")} ${safe(who)}: ${safe(message.content)}`;
  });
  return `<recent_discussion>\nRECENT DISCUSSION (oldest first; cite as M# only for statements made by the team):\n${lines.join("\n")}\n</recent_discussion>`;
}
