import type {
  BriefSection,
  CaseContext,
  CaseMemory,
  ContextDocument,
  ContextTeamMember,
  ResultFlag,
  SectionsContent,
  SourceRef,
  TaskPriority,
} from "@ccr/types";
import {
  DECISION_STATUS_LABELS,
  HANDOFF_SECTIONS,
  PATIENT_SEX_LABELS,
  TUMOR_BOARD_SECTIONS,
  emptyCaseMemory,
} from "@ccr/types";
import type { SourceRegistry } from "../../context/source-registry";
import { verifyQuote } from "../../context/source-registry";
import { mergeMemoryFacts } from "../../memory/merge";
import { addDays, type CaseSummaryDraft, type MissingInformationItem, type SuggestedTask } from "../types";
import {
  documentGist,
  findSection,
  firstSentences,
  isNursingNote,
  keySection,
  listItems,
  parseSections,
  pathologyDiagnoses,
  splitSentences,
} from "./clinical-text";
import { memoryFactsForDocument, truncate } from "./extract";
import { ANALYTES, describeTrend, labSeries, latestFlag, relativeChange } from "./labs";

export const DEMO_LIMITATIONS =
  "Assembled by the offline demo engine using rule-based extraction of verbatim record content. It does not weigh or interpret findings; verify against the cited sources.";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Collects sources and hands out numbered inline markers ("[1]"). */
export class Citer {
  readonly sources: SourceRef[] = [];
  constructor(private readonly registry: SourceRegistry) {}

  cite(recordId: string, excerpt?: string | null): string {
    const entry = this.registry.getById(recordId);
    if (!entry) return "";
    const verified = excerpt && verifyQuote(entry.text, excerpt) ? excerpt : null;
    let index = this.sources.findIndex((source) => source.id === recordId);
    if (index === -1) {
      const ref = this.registry.refForId(recordId, verified);
      if (!ref) return "";
      this.sources.push(ref);
      index = this.sources.length - 1;
    } else if (verified && !this.sources[index]!.excerpt) {
      this.sources[index] = { ...this.sources[index]!, excerpt: verified, verified: true };
    }
    return `[${index + 1}]`;
  }
}

export function byDateAsc(docs: ContextDocument[]): ContextDocument[] {
  return [...docs].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

function latest(docs: ContextDocument[], predicate: (doc: ContextDocument) => boolean): ContextDocument | undefined {
  return byDateAsc(docs).filter(predicate).at(-1);
}

function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

function formatShortDate(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Memory stored on the case, or rebuilt on the fly from documents. */
export function effectiveMemory(ctx: CaseContext): CaseMemory {
  if (ctx.memory && ctx.memory.processedDocumentIds.length > 0) return ctx.memory;
  let memory: CaseMemory = emptyCaseMemory(new Date(ctx.now));
  for (const doc of byDateAsc(ctx.documents)) {
    memory = mergeMemoryFacts(memory, memoryFactsForDocument(doc), doc, new Date(ctx.now));
  }
  return memory;
}

function pathologyDiagnosisText(doc: ContextDocument): string {
  return pathologyDiagnoses(doc.text, 2).join(" ");
}

/** First diagnosis sentence, verbatim, for use as a citation excerpt. */
function pathologyExcerpt(doc: ContextDocument): string | undefined {
  return pathologyDiagnoses(doc.text, 1)[0];
}

function imagingImpression(doc: ContextDocument, count = 2): string[] {
  const impression = findSection(parseSections(doc.text), ["IMPRESSION", "CONCLUSION"]);
  if (!impression) return [firstSentences(doc.text, count)];
  const items = listItems(impression.body);
  return items.length ? items.slice(0, count) : splitSentences(impression.body).slice(0, count);
}

function toResultFlag(flag: string): ResultFlag {
  if (flag === "critical") return "critical";
  if (flag === "normal") return "normal";
  if (flag === "unknown") return "unknown";
  return "abnormal";
}

function findMember(ctx: CaseContext, pattern: RegExp): ContextTeamMember | undefined {
  return ctx.team.find((member) => pattern.test(`${member.specialty ?? ""} ${member.role}`));
}

function pendingDecisions(ctx: CaseContext) {
  return ctx.decisions.filter((decision) => decision.status === "PROPOSED" || decision.status === "UNDER_REVIEW");
}

// ── Case summary ───────────────────────────────────────────────────────────

/**
 * Where the case stands: the assessment of the latest physician note (not a
 * procedure note), plus the latest nursing update when it is more recent.
 */
export function currentStatusParts(ctx: CaseContext): Array<{ text: string; docId: string; excerpt: string }> {
  const docs = byDateAsc(ctx.documents);
  const parts: Array<{ text: string; docId: string; excerpt: string }> = [];
  const physician = docs
    .filter((doc) => (doc.type === "CLINICAL_NOTE" || doc.type === "DISCHARGE_SUMMARY") && !isNursingNote(doc))
    .filter((doc) => findSection(parseSections(doc.text), ["ASSESSMENT AND PLAN", "ASSESSMENT", "DISCHARGE DIAGNOSIS"]))
    .at(-1);
  if (physician) {
    const section = findSection(parseSections(physician.text), ["ASSESSMENT AND PLAN", "ASSESSMENT", "DISCHARGE DIAGNOSIS"])!;
    const sentence = firstSentences(section.body, 1);
    parts.push({ text: `${sentence.replace(/\.$/, "")} (${physician.title}, ${formatShortDate(physician.date)}).`, docId: physician.id, excerpt: sentence });
  }
  const nursing = docs.filter(isNursingNote).at(-1);
  if (nursing && (!physician || nursing.date >= physician.date)) {
    const section = findSection(parseSections(nursing.text), ["SITUATION", "ASSESSMENT"]);
    const sentence = firstSentences(section?.body ?? nursing.text, 1);
    parts.push({ text: `Latest nursing update (${formatShortDate(nursing.date)}): ${lowerFirst(sentence)}`, docId: nursing.id, excerpt: sentence });
  }
  return parts;
}

export function buildCaseSummary(ctx: CaseContext, registry: SourceRegistry): CaseSummaryDraft {
  const { patient } = ctx;
  const docs = byDateAsc(ctx.documents);
  const memory = effectiveMemory(ctx);
  const headline = `${patient.age}-year-old ${PATIENT_SEX_LABELS[patient.sex].toLowerCase()} with ${lowerFirst(patient.primaryDiagnosis)}.`;

  const currentStatus = currentStatusParts(ctx).map((part) => part.text).join(" ") ||
    (docs.length
      ? `Most recent record: ${docs.at(-1)!.title} (${formatShortDate(docs.at(-1)!.date)}).`
      : "No clinical documents have been uploaded yet.");

  const pathology = latest(docs, (doc) => doc.type === "PATHOLOGY_REPORT");
  const EXTENT = /metasta|involvement|resectab|stage|extent|lymph/i;
  const extent = docs
    .filter((doc) => doc.type === "IMAGING_REPORT")
    .map((doc) => imagingImpression(doc, 4).find((item) => EXTENT.test(item)))
    .filter((item): item is string => Boolean(item))
    .at(-1);
  const currentDiagnosis = [pathology ? pathologyDiagnosisText(pathology) : patient.primaryDiagnosis, extent]
    .filter(Boolean)
    .join(" ");

  const treatments = memory.treatments.filter((t) => t.status !== "completed" && t.status !== "unknown");
  const currentTreatment = treatments.length
    ? treatments
        .slice(-5)
        .map((t) => `${t.name} (${t.status})`)
        .join("; ") + "."
    : "No active treatment documented.";

  const citer = new Citer(registry);
  const keyFindings: CaseSummaryDraft["keyFindings"] = [];
  const addFinding = (doc: ContextDocument, text: string, excerpt: string | undefined = text) => {
    citer.cite(doc.id, excerpt);
    keyFindings.push({ text, sources: citer.sources.filter((s) => s.id === doc.id) });
  };
  for (const doc of docs.filter((d) => d.type === "IMAGING_REPORT").slice(-2)) addFinding(doc, imagingImpression(doc, 1)[0] ?? doc.title);
  if (pathology) addFinding(pathology, pathologyDiagnosisText(pathology), pathologyExcerpt(pathology));
  const consults = docs.filter((doc) => doc.type === "CLINICAL_NOTE" && /consult/i.test(doc.title)).slice(-2);
  for (const doc of consults) {
    const section = findSection(parseSections(doc.text), ["ASSESSMENT", "ASSESSMENT AND PLAN", "IMPRESSION"]);
    if (section) addFinding(doc, firstSentences(section.body, 1));
  }

  const latestResults: CaseSummaryDraft["latestResults"] = [];
  for (const analyte of ANALYTES) {
    const series = labSeries(ctx, analyte);
    const last = series.at(-1);
    if (!last) continue;
    const flag = toResultFlag(latestFlag(series));
    citer.cite(last.documentId, last.excerpt);
    latestResults.push({
      label: analyte.label,
      value: `${last.value}${last.unit ? ` ${last.unit}` : ""}${series.length > 1 ? ` (trend ${describeTrend(series, 3)})` : ""}`,
      date: last.date,
      flag,
      sources: citer.sources.filter((s) => s.id === last.documentId),
    });
  }
  latestResults.sort((a, b) => Number(a.flag === "normal") - Number(b.flag === "normal"));

  const outstandingQuestions = [
    ...memory.openQuestions.filter((q) => !/^recommend/i.test(q)),
    ...pendingDecisions(ctx).map((d) => `Decision #${d.number} "${d.title}" is ${DECISION_STATUS_LABELS[d.status].toLowerCase()}; awaiting ${d.approvals.filter((a) => a.status === "PENDING").map((a) => a.reviewer).join(", ") || "reviewers"}.`),
  ].slice(0, 6);

  return {
    headline,
    currentStatus,
    currentDiagnosis,
    currentTreatment,
    keyFindings: keyFindings.slice(0, 6),
    latestResults: latestResults.slice(0, 6),
    outstandingQuestions,
    limitations: `${DEMO_LIMITATIONS} Based on ${docs.length} document${docs.length === 1 ? "" : "s"}.`,
  };
}

// ── Missing information ────────────────────────────────────────────────────

interface Check {
  item: string;
  reason: string;
  priority: "high" | "medium" | "low";
  applies: (ctx: CaseContext, corpus: string) => boolean;
  present: (ctx: CaseContext, corpus: string) => boolean;
}

const titleHas = (ctx: CaseContext, pattern: RegExp) => ctx.documents.some((doc) => pattern.test(doc.title));
const isOncology = (ctx: CaseContext) => ctx.caseRoom.specialty === "ONCOLOGY";

const CHECKS: Check[] = [
  {
    item: "Tissue diagnosis (pathology report)",
    reason: "Treatment planning requires histologic confirmation.",
    priority: "high",
    applies: isOncology,
    present: (ctx) => ctx.documents.some((doc) => doc.type === "PATHOLOGY_REPORT"),
  },
  {
    item: "Staging imaging report",
    reason: "Extent of disease determines treatment intent and sequencing.",
    priority: "high",
    applies: isOncology,
    present: (ctx) => ctx.documents.some((doc) => doc.type === "IMAGING_REPORT" && /\b(ct|mri|pet)\b/i.test(`${doc.title} ${doc.text}`)),
  },
  {
    item: "Molecular / biomarker testing results",
    reason: "Biomarker results can change treatment options; they are recommended or pending in the record but no results are documented.",
    priority: "high",
    applies: isOncology,
    present: (ctx, corpus) =>
      titleHas(ctx, /molecular|genomic|\bngs\b|sequencing|biomarker|mutation/i) ||
      /\b(KRAS|EGFR|ALK|BRAF|HER2|ROS1)\b[^.\n]{0,40}\b(mutat\w*|wild[- ]type|not detected|detected|amplified|3\+)/i.test(corpus),
  },
  {
    item: "Germline genetic testing",
    reason: "Guidelines recommend germline testing for this cancer type; no result is documented.",
    priority: "medium",
    applies: (ctx) => isOncology(ctx) && /pancrea|breast|ovar|prostate/i.test(ctx.patient.primaryDiagnosis),
    present: (ctx, corpus) => titleHas(ctx, /germline|genetic/i) || /germline[^.\n]{0,60}(result|negative|positive|pathogenic|variant)/i.test(corpus),
  },
  {
    item: "Brain MRI for staging",
    reason: "Recommended for staging of stage II-III non-small cell lung cancer before definitive therapy.",
    priority: "high",
    applies: (ctx) => /lung|nsclc/i.test(ctx.patient.primaryDiagnosis),
    present: (ctx) => titleHas(ctx, /brain|mri head|head mri/i),
  },
  {
    item: "Baseline echocardiogram (LVEF)",
    reason: "Required before HER2-directed or anthracycline therapy.",
    priority: "high",
    applies: (ctx, corpus) => /her2[^.\n]{0,20}(positive|3\+)/i.test(corpus),
    present: (_ctx, corpus) => /lvef|ejection fraction/i.test(corpus),
  },
  {
    item: "Surgical opinion",
    reason: "Resectability should be assessed by a surgeon for localized solid tumors.",
    priority: "medium",
    applies: (ctx) => isOncology(ctx) && !/metasta|stage iv/i.test(ctx.patient.primaryDiagnosis),
    present: (ctx) => ctx.documents.some((doc) => doc.type === "CLINICAL_NOTE" && /surg/i.test(doc.title)),
  },
  {
    item: "Performance status (ECOG / Karnofsky)",
    reason: "Fitness for treatment is part of every tumor board recommendation.",
    priority: "medium",
    applies: isOncology,
    present: (_ctx, corpus) => /\b(ecog|karnofsky|kps)\b/i.test(corpus),
  },
  {
    item: "Nutrition assessment",
    reason: "Weight loss is documented but no nutrition assessment is in the record.",
    priority: "medium",
    applies: (_ctx, corpus) => /weight loss/i.test(corpus),
    present: (ctx) => titleHas(ctx, /nutrition|dietitian|dietetic/i),
  },
  {
    item: "Echocardiogram",
    reason: "Ventricular function guides heart failure therapy.",
    priority: "high",
    applies: (ctx) => ctx.caseRoom.specialty === "CARDIOLOGY",
    present: (_ctx, corpus) => /echocardiogra|lvef|ejection fraction/i.test(corpus),
  },
  {
    item: "ECG",
    reason: "Rhythm and conduction assessment is expected for cardiac admissions.",
    priority: "medium",
    applies: (ctx) => ctx.caseRoom.specialty === "CARDIOLOGY",
    present: (_ctx, corpus) => /\b(ecg|ekg|electrocardiogram)\b/i.test(corpus),
  },
  {
    item: "Medication list",
    reason: "Needed for reconciliation and interaction review.",
    priority: "low",
    applies: () => true,
    present: (_ctx, corpus) => /medications:/i.test(corpus),
  },
  {
    item: "Allergy documentation",
    reason: "Required before new therapies are started.",
    priority: "low",
    applies: () => true,
    present: (_ctx, corpus) => /allerg/i.test(corpus),
  },
  {
    item: "Patient goals and preferences",
    reason: "Shared decision-making requires documented goals of care.",
    priority: "low",
    applies: () => true,
    present: (_ctx, corpus) => /goals of care|patient (preference|wishes)|advance directive|counseled/i.test(corpus),
  },
];

export function buildMissingInformation(ctx: CaseContext): MissingInformationItem[] {
  const corpus = ctx.documents.map((doc) => doc.text).join("\n");
  const order = { high: 0, medium: 1, low: 2 } as const;
  return CHECKS.filter((check) => check.applies(ctx, corpus) && !check.present(ctx, corpus))
    .map(({ item, reason, priority }) => ({ item, reason, priority }))
    .sort((a, b) => order[a.priority] - order[b.priority])
    .slice(0, 8);
}

// ── Sections helpers ───────────────────────────────────────────────────────

/**
 * Build a brief section. Markers in `lines` index into the builder-wide
 * `citer.sources`; they are renumbered so that "[1]" refers to the first entry
 * of this section's own `sources` array.
 */
function section(key: string, title: string, lines: string[], citer: Citer, fallback = "Not documented."): BriefSection {
  const raw = lines.filter(Boolean).join("\n").trim() || fallback;
  const sources: SourceRef[] = [];
  const localIndex = new Map<number, number>();
  const body = raw
    .replace(/\[(\d+)\]/g, (_match, n: string) => {
      const globalIndex = Number(n) - 1;
      const source = citer.sources[globalIndex];
      if (!source) return "";
      if (!localIndex.has(globalIndex)) {
        sources.push(source);
        localIndex.set(globalIndex, sources.length);
      }
      return `[${localIndex.get(globalIndex)}]`;
    })
    .replace(/[ \t]+$/gm, "");
  return { key, title, body, sources };
}

function titleFor(keys: ReadonlyArray<{ key: string; title: string }>, key: string): string {
  return keys.find((entry) => entry.key === key)?.title ?? key;
}

// ── Handoff ────────────────────────────────────────────────────────────────

const RISK_PATTERNS: Array<[RegExp, string]> = [
  [/bleed|hemorrhag|melena|dark stool/i, "Bleeding"],
  [/sepsis|bacteremia|cultures?|fever|cholangitis|infection/i, "Infection"],
  [/enoxaparin|heparin|anticoag/i, "Anticoagulation"],
  [/fall|opioid|sedat/i, "Falls"],
  [/hypotension|hypoxia|desaturat/i, "Hemodynamic instability"],
  [/creatinine (rising|increased)|aki|kidney injury/i, "Kidney injury"],
];

export function buildHandoff(ctx: CaseContext, registry: SourceRegistry): SectionsContent {
  const citer = new Citer(registry);
  const docs = byDateAsc(ctx.documents);
  const note = latest(docs, isNursingNote) ?? latest(docs, (doc) => doc.type === "CLINICAL_NOTE");
  const sections = note ? parseSections(note.text) : [];
  const today = ctx.now.slice(0, 10);
  const recentCutoff = addDays(today, -3);

  // Current condition
  const conditionSection = findSection(sections, ["ASSESSMENT", "CURRENT CONDITION", "SITUATION"]);
  const condition = note && conditionSection ? firstSentences(conditionSection.body, 2) : "";
  const currentCondition = condition && note ? [`${condition} ${citer.cite(note.id, firstSentences(conditionSection!.body, 1))}`] : [];

  // Changes since previous shift
  const changes: string[] = [];
  const trendWindowStart = addDays(today, -7);
  let trendCount = 0;
  for (const analyte of ANALYTES) {
    const series = labSeries(ctx, analyte).filter((p) => p.date >= trendWindowStart);
    const last = series.at(-1);
    if (!last || series.length < 2 || last.date < recentCutoff || trendCount >= 4) continue;
    const change = relativeChange(series.slice(-3));
    if (change == null || Math.abs(change) < 0.15) continue;
    trendCount += 1;
    changes.push(`- ${analyte.label} ${change < 0 ? "decreased" : "increased"}: ${describeTrend(series, 3)} ${citer.cite(last.documentId, last.excerpt)}`);
  }
  const situation = findSection(sections, ["SITUATION"]);
  if (note && situation) {
    for (const sentence of splitSentences(situation.body).slice(0, 2)) changes.push(`- ${sentence} ${citer.cite(note.id, sentence)}`);
  }
  const actions = findSection(sections, ["ACTIONS TAKEN", "INTERVENTIONS"]);
  if (note && actions) {
    for (const item of listItems(actions.body).slice(0, 4)) changes.push(`- ${item} ${citer.cite(note.id, item)}`);
  }
  for (const doc of docs.filter((d) => d.date >= addDays(today, -2) && d.id !== note?.id)) {
    changes.push(`- New ${doc.type === "LAB_RESULT" ? "results" : "record"}: ${doc.title} (${formatShortDate(doc.date)}) ${citer.cite(doc.id)}`);
  }

  // Pending
  const pending: string[] = [];
  const pendingSection = findSection(sections, ["PENDING", "PENDING RESULTS"]);
  if (note && pendingSection) {
    for (const item of listItems(pendingSection.body)) pending.push(`- ${item} ${citer.cite(note.id, item)}`);
  }
  for (const task of ctx.tasks.filter((t) => t.status !== "DONE" && t.dueDate && t.dueDate <= addDays(today, 1)).slice(0, 3)) {
    pending.push(`- Task: ${task.title}${task.assignee ? ` (${task.assignee})` : ""}${task.dueDate ? `, due ${formatShortDate(task.dueDate)}` : ""} ${citer.cite(task.id)}`);
  }

  // Risks
  const risks: string[] = [];
  const riskSection = findSection(sections, ["RISKS", "SAFETY CONCERNS"]);
  if (note && riskSection) {
    for (const item of listItems(riskSection.body)) risks.push(`- ${item} ${citer.cite(note.id, item)}`);
  } else {
    const recentDocsNewestFirst = docs.filter((doc) => doc.date >= addDays(today, -5)).reverse();
    for (const [pattern, label] of RISK_PATTERNS) {
      for (const doc of recentDocsNewestFirst) {
        const sentence = splitSentences(doc.text).find((s) => pattern.test(s));
        if (sentence) {
          risks.push(`- ${label}: ${sentence} ${citer.cite(doc.id, sentence)}`);
          break;
        }
      }
    }
  }

  // Next actions
  const nextActions: string[] = [];
  const planSection = findSection(sections, ["RECOMMENDATIONS FOR NEXT SHIFT", "PLAN", "RECOMMENDATIONS", "ASSESSMENT AND PLAN"]);
  if (note && planSection) {
    for (const item of listItems(planSection.body).slice(0, 6)) nextActions.push(`- ${item} ${citer.cite(note.id, item)}`);
  }
  const listed = [...pending, ...nextActions].join("\n").toLowerCase();
  for (const task of ctx.tasks.filter((t) => t.status !== "DONE" && t.priority !== "LOW" && !listed.includes(t.title.toLowerCase())).slice(0, 2)) {
    nextActions.push(`- ${task.title}${task.assignee ? ` (owner: ${task.assignee})` : ""} ${citer.cite(task.id)}`);
  }

  const lines: Record<string, string[]> = {
    currentCondition,
    changesSincePrevious: changes,
    pending,
    risks,
    nextActions,
  };
  return {
    kind: "sections",
    sections: HANDOFF_SECTIONS.map(({ key }) => section(key, titleFor(HANDOFF_SECTIONS, key), lines[key] ?? [], citer)),
    limitations: `${DEMO_LIMITATIONS} Handoff content is drawn mainly from ${note ? `"${note.title}" (${formatShortDate(note.date)})` : "the most recent records"} and open tasks.`,
  };
}

// ── Tumor board brief ─────────────────────────────────────────────────────

export function buildTumorBoardBrief(ctx: CaseContext, registry: SourceRegistry): SectionsContent {
  const citer = new Citer(registry);
  const docs = byDateAsc(ctx.documents);
  const summary = buildCaseSummary(ctx, registry);
  const memory = effectiveMemory(ctx);
  const missing = buildMissingInformation(ctx);

  const firstConsult = docs.find((doc) => doc.type === "CLINICAL_NOTE" && findSection(parseSections(doc.text), ["HISTORY OF PRESENT ILLNESS"]));
  const history: string[] = [];
  if (firstConsult) {
    const sections = parseSections(firstConsult.text);
    const hpi = findSection(sections, ["HISTORY OF PRESENT ILLNESS"]);
    if (hpi) history.push(`${firstSentences(hpi.body, 2)} ${citer.cite(firstConsult.id, firstSentences(hpi.body, 1))}`);
    for (const name of ["PAST MEDICAL HISTORY", "FAMILY HISTORY", "SOCIAL HISTORY"]) {
      const part = findSection(sections, [name]);
      if (part) history.push(`- ${name.charAt(0)}${name.slice(1).toLowerCase()}: ${firstSentences(part.body, 2)} ${citer.cite(firstConsult.id, firstSentences(part.body, 1))}`);
    }
  }

  const imaging = docs
    .filter((doc) => doc.type === "IMAGING_REPORT")
    .map((doc) => {
      const items = imagingImpression(doc, 2);
      return `- ${formatShortDate(doc.date)}, ${doc.title}: ${items.join(" ")} ${citer.cite(doc.id, items[0])}`;
    });

  const pathology = docs
    .filter((doc) => doc.type === "PATHOLOGY_REPORT")
    .map((doc) => {
      const diagnosis = pathologyDiagnosisText(doc);
      const ihc = findSection(parseSections(doc.text), ["IMMUNOHISTOCHEMISTRY", "BIOMARKERS", "MARKERS"]);
      const notable = ihc ? splitSentences(ihc.body).filter((s) => /lost|loss|positive \(|3\+|%|amplif/i.test(s)).slice(0, 2).join(" ") : "";
      return `- ${formatShortDate(doc.date)}, ${doc.title}: ${diagnosis}${notable ? ` ${notable}` : ""} ${citer.cite(doc.id, pathologyExcerpt(doc))}`;
    });

  const labs: string[] = [];
  for (const analyte of ANALYTES) {
    const series = labSeries(ctx, analyte);
    const last = series.at(-1);
    if (!last) continue;
    const abnormal = series.some((p) => p.flag !== "normal" && p.flag !== "unknown");
    if (!abnormal && !/ca 19-9|cea|ca-125|hemoglobin/i.test(analyte.label)) continue;
    labs.push(`- ${analyte.label}: ${series.length > 1 ? describeTrend(series, 4) : `${last.value} ${last.unit}`.trim()} (latest ${formatShortDate(last.date)}) ${citer.cite(last.documentId, last.excerpt)}`);
  }

  const treatmentLine = (t: CaseMemory["treatments"][number]) =>
    `- ${t.name} (${t.status}): ${t.detail} ${t.sourceDocumentId ? citer.cite(t.sourceDocumentId, t.detail) : ""}`;
  const previous = memory.treatments.filter((t) => t.status === "completed").map(treatmentLine);
  const current = memory.treatments.filter((t) => t.status === "active" || t.status === "planned" || t.status === "held").map(treatmentLine);

  const questionsSource = docs
    .map((doc) => ({ doc, section: findSection(parseSections(doc.text), ["QUESTIONS FOR TUMOR BOARD"]) }))
    .filter((entry) => entry.section)
    .at(-1);
  let boardQuestions: string[] = [];
  if (questionsSource?.section) {
    boardQuestions = listItems(questionsSource.section.body).map(
      (question, index) => `${index + 1}. ${question} ${citer.cite(questionsSource.doc.id, question)}`,
    );
  } else {
    const corpus = docs.map((doc) => doc.text).join("\n");
    const derived: string[] = [];
    if (/resectab/i.test(corpus)) derived.push("Is the tumor surgically resectable?");
    if (/neoadjuvant/i.test(corpus)) derived.push("Should neoadjuvant treatment be initiated before local therapy?");
    if (missing.some((m) => /molecular/i.test(m.item))) derived.push("Is additional molecular testing required before treatment selection?");
    derived.push("What is the recommended treatment plan and sequencing?");
    boardQuestions = derived.map((question, index) => `${index + 1}. ${question}`);
  }

  const decisionsRequired = pendingDecisions(ctx).map(
    (d) => `- Decision #${d.number} (${DECISION_STATUS_LABELS[d.status]}): ${d.title}. Awaiting ${d.approvals.filter((a) => a.status === "PENDING").map((a) => a.reviewer).join(", ") || "review"}. ${citer.cite(d.id)}`,
  );

  const lines: Record<string, string[]> = {
    caseSummary: [
      summary.headline,
      ...currentStatusParts(ctx).map((part) => `${part.text} ${citer.cite(part.docId, part.excerpt)}`),
    ],
    diagnosis: [summary.currentDiagnosis, pathology.length ? "" : "No pathology report in the record."],
    patientHistory: history,
    imaging,
    pathology,
    labs,
    previousTreatment: previous.length ? previous : ["No prior cancer-directed therapy documented."],
    currentTreatment: current,
    missingInformation: missing.map((m) => `- ${m.item}: ${m.reason}`),
    openQuestions: memory.openQuestions.filter((q) => !/^recommend/i.test(q)).map((q) => `- ${truncate(q, 220)}`),
    decisionsRequired: decisionsRequired.length ? decisionsRequired : boardQuestions.slice(0, 2).map((q) => `- ${q.replace(/^\d+\.\s*/, "")}`),
    questionsForTumorBoard: boardQuestions,
  };

  return {
    kind: "sections",
    sections: TUMOR_BOARD_SECTIONS.map(({ key }) => section(key, titleFor(TUMOR_BOARD_SECTIONS, key), lines[key] ?? [], citer)),
    limitations: `${DEMO_LIMITATIONS} Review every section before sharing with the tumor board.`,
  };
}

// ── Follow-up tasks ────────────────────────────────────────────────────────

export function buildFollowUpTasks(ctx: CaseContext, decisionId: string): SuggestedTask[] {
  const decision = ctx.decisions.find((d) => d.id === decisionId);
  if (!decision) return [];
  const text = `${decision.title} ${decision.description} ${decision.rationale}`;
  const today = ctx.now.slice(0, 10);
  const coordinator = findMember(ctx, /coordinat|navigat|CARE_COORDINATOR/i);
  const nurse = findMember(ctx, /nurs|NURSE/i);
  const radiology = findMember(ctx, /radiolog/i);
  const surgeon = findMember(ctx, /surg/i);
  const pathologist = findMember(ctx, /patholog/i);
  const proposer = ctx.team.find((member) => member.name === decision.proposedBy);
  const missing = buildMissingInformation(ctx);

  const tasks: SuggestedTask[] = [];
  const add = (title: string, description: string, priority: TaskPriority, owner: ContextTeamMember | undefined, days: number) => {
    if (tasks.some((task) => task.title === title)) return;
    tasks.push({ title, description, priority, assigneeId: owner?.id ?? proposer?.id ?? null, dueDate: addDays(today, days) });
  };

  add(
    "Communicate approved plan to patient and document the discussion",
    `Review Decision #${decision.number} with the patient and family and document shared decision-making.`,
    "HIGH",
    proposer,
    2,
  );
  if (/chemo|systemic|folfirinox|tchp|folfox|immunotherapy|neoadjuvant/i.test(text)) {
    add("Coordinate treatment start (consent, education, scheduling)", "Schedule chemotherapy teaching, consent visit and first infusion appointment.", "HIGH", coordinator ?? nurse, 5);
    add("Arrange port placement", "Request port placement before the first cycle.", "MEDIUM", coordinator, 7);
  }
  if (/restag|re-?evaluat|repeat (ct|imaging)|response assessment/i.test(text)) {
    add("Schedule restaging imaging", "Book restaging imaging at the interval specified in the decision.", "MEDIUM", radiology ?? coordinator, 56);
  }
  if (/surg|resect/i.test(text)) {
    add("Book surgical re-evaluation after restaging", "Surgical oncology follow-up once restaging imaging is available.", "MEDIUM", surgeon ?? coordinator, 60);
  }
  for (const item of missing) {
    if (/molecular/i.test(item.item)) add("Place order for molecular (NGS) testing on tumor tissue", item.reason, "HIGH", pathologist ?? proposer, 3);
    if (/germline/i.test(item.item)) add("Refer for germline genetic counseling", item.reason, "MEDIUM", coordinator, 10);
    if (/nutrition/i.test(item.item)) add("Complete nutrition assessment", item.reason, "MEDIUM", nurse, 3);
  }
  return tasks.slice(0, 6);
}

export { documentGist };
