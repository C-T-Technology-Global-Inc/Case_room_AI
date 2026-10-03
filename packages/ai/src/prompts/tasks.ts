import type { CaseContext, ContextDocument, ContextRequester } from "@ccr/types";
import { DOCUMENT_TYPE_LABELS, USER_ROLE_LABELS } from "@ccr/types";
import { quoted, safe } from "../context/format-context";

/**
 * Task-specific instructions, placed after the case data in the user turn.
 * Record values repeated here (names, titles, diagnosis) go through `quoted`.
 */

function requesterLine(requester: ContextRequester | null): string {
  if (!requester) return "";
  return `The request comes from team member ${quoted(requester.name)} (${quoted(requester.specialty ?? USER_ROLE_LABELS[requester.role])}). Tailor wording to their role, without changing the facts.`;
}

export function caseQuestionPrompt(input: { question: string; requester: ContextRequester | null }): string {
  return [
    "<question>",
    safe(input.question),
    "</question>",
    "",
    "A member of the care team asked the question above in the case discussion (it may refer to earlier messages, e.g. 'this' or 'the latest CT').",
    requesterLine(input.requester),
    "Answer using only the case record and case state. Cite every record you rely on, with a short verbatim quote copied exactly from it. You may also mark statements inline with the key in square brackets, e.g. [D3].",
    "If the record does not answer the question, set confidence to 'insufficient', say what is not documented, and do not speculate.",
    "If the question asks you to decide, diagnose, prescribe or choose a treatment, do not do it: summarize what the team has documented relevant to that choice and note that the decision rests with the treating clinicians.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function caseSummaryPrompt(ctx: CaseContext): string {
  return [
    "Write the shared case summary shown at the top of this patient's case room. The whole care team (physicians, nurses, coordinators) reads it before discussing the case.",
    `Specialty context: ${ctx.caseRoom.specialty}.`,
    "Cover: who the patient is (headline), current status, current diagnosis (with stage or extent if documented), current or planned treatment, the key documented findings, the most recent important results, and the questions the team still needs to resolve.",
    "Every key finding and result must cite its source documents. Only report results that appear in the record, with values and units exactly as written.",
    "Pending decisions are not final; describe them as proposed or under review.",
  ].join("\n");
}

export function missingInformationPrompt(ctx: CaseContext): string {
  return [
    "Identify information that a multidisciplinary team would normally need for this type of case but that is not present in the case record.",
    `Specialty context: ${ctx.caseRoom.specialty}. Primary diagnosis as recorded: ${quoted(ctx.patient.primaryDiagnosis)}.`,
    "Consider, where relevant: tissue diagnosis, staging studies, tumor markers or key labs, molecular/biomarker results, germline testing, performance status, comorbidities, medication list, allergies, prior treatments, specialist opinions, and patient goals or preferences.",
    "List only items that are genuinely absent or explicitly still pending in the record. Do not list items that are documented. Return at most 8 items, most important first.",
  ].join("\n");
}

export function timelinePrompt(documents: ContextDocument[], keys: Map<string, string>): string {
  const list = documents
    .map((doc) => `- ${keys.get(doc.id) ?? "?"}: ${quoted(doc.title)} (${DOCUMENT_TYPE_LABELS[doc.type]}, dated ${doc.date})`)
    .join("\n");
  return [
    "Extract the clinically meaningful events for the patient timeline from these documents:",
    list,
    "",
    "Rules:",
    "- One event per distinct clinical event (study performed, result reported, procedure, consultation, admission, treatment start/stop, decision). Usually 1-3 events per document.",
    "- Use the date the event happened. If the document gives no explicit date for an event, use the document date.",
    "- Do not create events for things that are only planned or recommended; mention those in the description of the event where they were recommended.",
    "- Return every event these documents contain: your output replaces anything previously extracted from them.",
    "- The TIMELINE section of the case state lists events recorded from other sources (clinicians' entries, other documents). Do not repeat those.",
    "- Set sourceKey to the key of the document the event comes from.",
  ].join("\n");
}

export function memoryFactsPrompt(document: ContextDocument, key: string): string {
  return [
    `Extract structured facts from document ${key} (${quoted(document.title)}, ${DOCUMENT_TYPE_LABELS[document.type]}, dated ${document.date}) to update the shared patient memory.`,
    "Only extract facts stated in this document. Use the exact values and units written. Leave a list empty if the document has nothing for it.",
    "- diagnoses: confirmed or working diagnoses (name + short detail such as stage/grade).",
    "- medications: current medications with dose/route/frequency if written.",
    "- labs: notable lab results (abnormal values and key markers) with the flag as documented.",
    "- imaging: studies and their key finding (one sentence).",
    "- pathology: key pathology findings (one sentence each).",
    "- treatments: therapies, procedures or interventions with status planned/active/completed/held.",
    "- problems: active clinical problems.",
    "- openQuestions: unresolved clinical questions raised in the document.",
  ].join("\n");
}

export function tumorBoardPrompt(): string {
  return [
    "Prepare the tumor board brief for this case. Clinicians will review and edit it before it is shared, and they present it at the multidisciplinary tumor board meeting.",
    "Fill every section from the record. When a section has nothing documented, write 'Not documented.' rather than leaving it empty or guessing.",
    "- imaging, pathology, labs: '- ' bullets, each with date, study and key finding, values as written.",
    "- missingInformation: what the board will likely need that is not in the record.",
    "- openQuestions: unresolved clinical questions.",
    "- decisionsRequired: decisions the board needs to make, including decisions currently proposed or under review (these are not final).",
    "- questionsForTumorBoard: numbered questions ('1. ...') phrased for the board to answer. Do not answer them.",
    "Cite sources for every section that states facts.",
  ].join("\n");
}

export function handoffPrompt(ctx: CaseContext): string {
  return [
    "Prepare a patient handoff for the next shift / covering clinician. It will be edited and approved by a clinician before it is considered final.",
    requesterLine(ctx.requester),
    "- currentCondition: 1-3 sentences on the patient's current clinical condition as last documented.",
    "- changesSincePrevious: '- ' bullets of changes documented in roughly the last 24-48 hours (new results, symptom changes, new orders, procedures). Include trends with values (e.g. 'Hemoglobin 12.8 -> 9.6 g/dL').",
    "- pending: '- ' bullets of results, consults, procedures or tasks still outstanding.",
    "- risks: '- ' bullets of documented risks to watch, with the documented reason.",
    "- nextActions: '- ' bullets of the next actions the team has documented or assigned (from notes and open tasks). Do not invent new orders or thresholds that are not in the record.",
    "Cite sources for every section.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function followUpTasksPrompt(input: {
  decisionKey: string;
  teamList: string;
}): string {
  return [
    `Decision ${input.decisionKey} has been approved by the care team. Suggest the operational follow-up tasks needed to carry it out.`,
    "Team members you may suggest as owners (use the U# key):",
    input.teamList,
    "",
    "Rules:",
    "- 2 to 6 concrete, checkable tasks: scheduling, referrals, orders that a clinician must place, documentation, patient communication, results to review.",
    "- Never include medication doses or prescribing instructions. Phrase clinical orders as 'Place order for ...' so a clinician places them.",
    "- Prefer owners whose specialty matches the task (e.g. scheduling -> care coordinator, imaging review -> radiology).",
    "- These are suggestions; a human will confirm each one before it is created.",
  ].join("\n");
}
