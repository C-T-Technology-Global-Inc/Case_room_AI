import { DOCUMENT_TYPE_LABELS, type ActorType, type DocumentType } from "@ccr/types";

/**
 * Human-readable sentences for audit events ("Dr. Nguyen uploaded a pathology
 * report."). Shared by the dashboard activity feed and the audit log views.
 */

export type ActivityKind = "ai" | "decision" | "document" | "task" | "case" | "brief" | "message" | "auth" | "org";

export interface ActivityInput {
  action: string;
  actorType: ActorType;
  metadata: unknown;
  user: { name: string } | null;
}

/** "Dr. Minh Nguyen" -> "Dr. Nguyen"; other names are kept as-is. */
export function shortName(name: string | null | undefined): string {
  if (!name) return "Someone";
  if (name.startsWith("Dr. ")) {
    const parts = name.slice(4).trim().split(/\s+/);
    return `Dr. ${parts.at(-1)}`;
  }
  return name;
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

function meta(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function describeActivity(event: ActivityInput): { text: string; kind: ActivityKind } {
  const m = meta(event.metadata);
  const who = shortName(event.user?.name);
  const title = str(m.title);
  const quoted = title ? ` “${title}”` : "";
  const decision = typeof m.number === "number" ? `Decision #${m.number}` : "a decision";
  const docType = str(m.documentType) as DocumentType | null;
  const docLabel = docType && DOCUMENT_TYPE_LABELS[docType] ? DOCUMENT_TYPE_LABELS[docType].toLowerCase() : "document";

  switch (event.action) {
    case "auth.signed_in":
      return { text: `${who} signed in.`, kind: "auth" };
    case "org.created":
      return { text: `${who} created the organization.`, kind: "org" };
    case "org.member_added":
      return { text: `${who} added ${str(m.memberName) ?? "a member"} to the organization.`, kind: "org" };
    case "org.member_invited":
      return { text: `${who} invited ${str(m.email) ?? "a new member"}.`, kind: "org" };
    case "org.invitation_revoked":
      return { text: `${who} revoked the invitation for ${str(m.email) ?? "a user"}.`, kind: "org" };
    case "org.invitation_accepted":
      return { text: `${who} joined the organization.`, kind: "org" };
    case "org.member_role_changed":
      return { text: `${who} changed ${str(m.memberName) ?? "a member"}'s role to ${str(m.to) ?? "a new role"}.`, kind: "org" };
    case "case.created":
      return { text: `${who} opened case room${quoted}.`, kind: "case" };
    case "case.status_changed":
      return { text: `${who} changed the case status to ${String(m.to ?? "").replace(/_/g, " ").toLowerCase()}.`, kind: "case" };
    case "case.member_added":
      return { text: `${who} added ${shortName(str(m.memberName))} to the care team.`, kind: "case" };
    case "document.uploaded":
      return { text: `${who} uploaded ${article(docLabel)} ${docLabel}${quoted}.`, kind: "document" };
    case "ai.document_processed":
      return { text: `AI updated the timeline and shared memory from${quoted || " a document"}.`, kind: "ai" };
    case "ai.document_failed":
      return { text: `AI could not process${quoted || " a document"}.`, kind: "ai" };
    case "timeline.event_added":
      return { text: `${who} added a timeline event${quoted}.`, kind: "case" };
    case "ai.timeline_generated":
      return { text: `AI generated an updated timeline (${String(m.events ?? "")} events).`, kind: "ai" };
    case "message.posted":
      return { text: `${who} posted in the discussion.`, kind: "message" };
    case "ai.question_asked":
      return { text: `${who} asked the AI${str(m.question) ? `: “${String(m.question).slice(0, 90)}”` : "."}`, kind: "ai" };
    case "ai.answer_generated":
      return { text: `AI answered ${who}'s question with ${String(m.sources ?? 0)} source${m.sources === 1 ? "" : "s"}.`, kind: "ai" };
    case "ai.answer_failed":
      return { text: `AI could not answer ${who}'s question.`, kind: "ai" };
    case "ai.summary_generated":
      return { text: `AI generated an updated case summary for ${who}.`, kind: "ai" };
    case "summary.reviewed":
      return { text: `${who} reviewed the AI case summary.`, kind: "brief" };
    case "tumor_board.generated":
      return { text: `AI prepared a tumor board brief for ${who}.`, kind: "ai" };
    case "handoff.generated":
      return { text: `AI drafted a patient handoff for ${who}.`, kind: "ai" };
    case "brief.edited":
      return { text: `${who} edited${quoted || " a brief"}.`, kind: "brief" };
    case "brief.approved":
      return { text: `${who} approved${quoted || " a brief"}.`, kind: "brief" };
    case "decision.proposed":
      return { text: `${who} proposed ${decision}${title ? `: ${title}` : ""}.`, kind: "decision" };
    case "decision.revised":
      return { text: `${who} revised ${decision}.`, kind: "decision" };
    case "decision.approved":
      return { text: `${who} approved ${decision}${title ? ` (${title})` : ""}.`, kind: "decision" };
    case "decision.rejected":
      return { text: `${who} rejected ${decision}.`, kind: "decision" };
    case "decision.changes_requested":
      return { text: `${who} requested changes to ${decision}.`, kind: "decision" };
    case "decision.finalized":
      return { text: `${decision} was recorded as the final human-approved decision.`, kind: "decision" };
    case "ai.tasks_suggested":
      return { text: `AI suggested follow-up tasks for ${decision}.`, kind: "ai" };
    case "task.created":
      return { text: `${who} created task${quoted}${m.aiSuggested ? " (AI-suggested)" : ""}.`, kind: "task" };
    case "task.status_changed":
      return { text: `${who} moved task${quoted} to ${String(m.to ?? "").replace(/_/g, " ").toLowerCase()}.`, kind: "task" };
    case "task.completed":
      return { text: `${who} completed task${quoted}.`, kind: "task" };
    default:
      return { text: `${who}: ${event.action}`, kind: event.actorType === "AI" ? "ai" : "case" };
  }
}
