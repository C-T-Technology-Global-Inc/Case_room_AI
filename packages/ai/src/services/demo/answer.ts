import type { AIConfidence, CaseContext, ContextDocument } from "@ccr/types";
import { APPROVAL_STATUS_LABELS, DECISION_STATUS_LABELS } from "@ccr/types";
import type { SourceRegistry } from "../../context/source-registry";
import { retrievePassages } from "../../retrieval/passages";
import { BM25Index } from "../../retrieval/bm25";
import { tokenize } from "../../retrieval/tokenize";
import type { CaseAnswer } from "../types";
import {
  Citer,
  DEMO_LIMITATIONS,
  buildCaseSummary,
  buildHandoff,
  buildMissingInformation,
  byDateAsc,
} from "./briefs";
import { findSection, firstSentences, isNursingNote, keySection, listItems, parseSections, splitSentences } from "./clinical-text";
import { describeTrend, detectAnalyte, labSeries } from "./labs";

/**
 * Offline question answering: intent detection + extraction of verbatim
 * record content, each statement tied to a numbered source. It never
 * generates clinical interpretation beyond simple juxtaposition.
 */

interface Topic {
  key: string;
  label: string;
  pattern: RegExp;
  match: (doc: ContextDocument) => boolean;
}

const MOLECULAR_DOC = /molecular|genomic|\bngs\b|sequencing|biomarker|mutation/i;

const TOPICS: Topic[] = [
  { key: "molecular", label: "molecular testing", pattern: /molecular|genomic|\bngs\b|sequencing|mutation|\b(egfr|kras|alk|braf|msi|mmr)\b/i, match: (d) => MOLECULAR_DOC.test(d.title) },
  { key: "pathology", label: "pathology", pattern: /patholog|biops|histolog|\bpath\b/i, match: (d) => d.type === "PATHOLOGY_REPORT" },
  { key: "ct", label: "CT", pattern: /\bct\b|computed tomograph/i, match: (d) => d.type === "IMAGING_REPORT" && /\bct\b|computed tomograph/i.test(`${d.title} ${d.text.slice(0, 300)}`) },
  { key: "mri", label: "MRI", pattern: /\bmri\b/i, match: (d) => d.type === "IMAGING_REPORT" && /\bmri\b/i.test(d.title) },
  { key: "pet", label: "PET", pattern: /\bpet\b/i, match: (d) => d.type === "IMAGING_REPORT" && /\bpet\b/i.test(d.title) },
  { key: "echo", label: "echocardiogram", pattern: /\becho/i, match: (d) => /echo/i.test(d.title) },
  { key: "imaging", label: "imaging", pattern: /imaging|scan|radiolog|mammo|ultrasound/i, match: (d) => d.type === "IMAGING_REPORT" },
  { key: "labs", label: "labs", pattern: /\blabs?\b|laborator|blood (work|test)|bloods/i, match: (d) => d.type === "LAB_RESULT" },
  { key: "surgery", label: "surgical consultation", pattern: /surg(eon|ical|ery)|resect/i, match: (d) => d.type === "CLINICAL_NOTE" && /surg/i.test(d.title) },
  { key: "oncology", label: "oncology consultation", pattern: /oncolog/i, match: (d) => d.type === "CLINICAL_NOTE" && /oncolog/i.test(d.title) },
  { key: "nursing", label: "nursing note", pattern: /nurs|shift|overnight/i, match: (d) => isNursingNote(d) },
  { key: "ercp", label: "ERCP", pattern: /ercp|stent/i, match: (d) => /ercp/i.test(d.title) },
  { key: "eus", label: "EUS", pattern: /\beus\b|endoscopic ultrasound/i, match: (d) => /\beus\b|endoscopic ultrasound/i.test(d.title) },
  { key: "admission", label: "admission note", pattern: /admission|admitted|\bh&p\b/i, match: (d) => /admission/i.test(d.title) },
  { key: "discharge", label: "discharge summary", pattern: /discharge/i, match: (d) => d.type === "DISCHARGE_SUMMARY" },
];

function topicsIn(text: string): Topic[] {
  return TOPICS.map((topic) => ({ topic, index: text.search(topic.pattern) }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.topic)
    .filter((topic, index, all) => !(topic.key === "imaging" && all.some((t, i) => i !== index && ["ct", "mri", "pet"].includes(t.key))));
}

function latestFor(ctx: CaseContext, topic: Topic): ContextDocument | undefined {
  return byDateAsc(ctx.documents).filter(topic.match).at(-1);
}

function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Key statements of a document, as verbatim sentences. */
function gistSentences(doc: ContextDocument, count = 2): string[] {
  const sections = parseSections(doc.text);
  if (MOLECULAR_DOC.test(doc.title)) {
    const results = findSection(sections, ["RESULTS", "FINDINGS"]);
    const interpretation = findSection(sections, ["INTERPRETATION", "COMMENT"]);
    return [...splitSentences(results?.body ?? "").slice(0, 5), ...splitSentences(interpretation?.body ?? "").slice(0, 2)];
  }
  if (doc.type === "PATHOLOGY_REPORT") {
    const diagnosis = findSection(sections, ["FINAL DIAGNOSIS", "DIAGNOSIS"]);
    const markers = findSection(sections, ["IMMUNOHISTOCHEMISTRY", "BIOMARKERS", "MARKERS"]);
    const comment = findSection(sections, ["COMMENT"]);
    const markerSentences = splitSentences(markers?.body ?? "");
    const notable = markerSentences.filter((s) => /lost|loss|amplif|3\+|%|score|positive \(/i.test(s));
    return [
      ...splitSentences(diagnosis?.body ?? "").slice(0, 3),
      ...[...notable, ...markerSentences.filter((sentence) => !notable.includes(sentence))].slice(0, 4),
      ...splitSentences(comment?.body ?? "").filter((s) => /adequate|recommend|pending|sent/i.test(s)).slice(0, 2),
    ].filter(Boolean);
  }
  if (doc.type === "IMAGING_REPORT") {
    const impression = findSection(sections, ["IMPRESSION", "CONCLUSION"]);
    const items = impression ? listItems(impression.body) : [];
    return (items.length ? items : splitSentences(impression?.body ?? doc.text)).slice(0, Math.max(count, 3));
  }
  if (doc.type === "LAB_RESULT") {
    const interpretation = findSection(sections, ["INTERPRETATION", "COMMENT"]);
    const micro = findSection(sections, ["MICROBIOLOGY"]);
    return [...splitSentences(interpretation?.body ?? "").slice(0, 2), ...splitSentences(micro?.body ?? "").slice(0, 1)];
  }
  const section = keySection(doc);
  const items = section ? listItems(section.body) : [];
  const sentences = splitSentences(section?.body ?? doc.text);
  return (sentences.length ? sentences : items).slice(0, count);
}

/** Number of distinct concepts in a question (tokens before synonym expansion). */
function conceptCount(query: string): number {
  return new Set(tokenize(query)).size;
}

interface Hit {
  /** Record id (document or discussion message) for citation. */
  recordId: string;
  label: string;
  date: string;
  sentence: string;
  score: number;
  overlap: number;
}

const HEADING_ONLY = /^[A-Z0-9 /&(),'+-]{3,}:?$|:$/;

/**
 * Sentence-level retrieval over documents and team discussion: BM25 picks the
 * candidate passages/messages, then sentences are ranked by query-term overlap.
 */
function bestSentences(ctx: CaseContext, query: string, limit: number): Hit[] {
  const queryTerms = new Set(tokenize(query, { expand: true }));
  const asksWhen = /^\s*when\b|\bwhat (date|time|day)\b|\bscheduled\b/i.test(query);
  const hasDateOrTime = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b|\b\d{1,2}:\d{2}\b|\b\d{4}-\d{2}-\d{2}\b/i;
  const candidates: Hit[] = [];
  const consider = (recordId: string, label: string, date: string, text: string, baseScore: number) => {
    for (const sentence of splitSentences(text)) {
      if (sentence.length <= 20 || HEADING_ONLY.test(sentence)) continue;
      const terms = new Set(tokenize(sentence, { expand: true }));
      const overlap = [...queryTerms].filter((term) => terms.has(term)).length;
      if (overlap === 0) continue;
      const temporalBoost = asksWhen && hasDateOrTime.test(sentence) ? 3 : 0;
      candidates.push({ recordId, label, date, sentence, score: overlap * 2 + baseScore / 10 + temporalBoost, overlap });
    }
  };

  for (const { item, score } of retrievePassages(ctx, query, 6)) {
    const doc = ctx.documents.find((d) => d.id === item.documentId);
    if (doc) consider(doc.id, doc.title, doc.date, item.text, score);
  }
  const discussion = ctx.messages.filter((m) => m.type === "USER");
  const index = new BM25Index(discussion.map((message) => ({ item: message, text: message.content })));
  for (const { item, score } of index.search(query, 4)) {
    consider(item.id, `Discussion: ${item.author}`, item.createdAt.slice(0, 10), item.content, score);
  }

  const seen = new Set<string>();
  return candidates
    .sort((a, b) => b.score - a.score)
    .filter((c) => (seen.has(c.sentence) ? false : (seen.add(c.sentence), true)))
    .slice(0, limit);
}

/**
 * Resolve "this"/"that" in a follow-up question to the topic of the most
 * recent exchange: recent AI answers first, then any recent message.
 */
function previousTopic(ctx: CaseContext, question: string, exclude: Topic[]): Topic | undefined {
  const excluded = new Set(exclude.map((t) => t.key));
  const recent = [...ctx.messages].reverse().filter((m) => !m.content.includes(question)).slice(0, 8);
  for (const pool of [recent.filter((m) => m.type === "AI"), recent]) {
    for (const message of pool) {
      const topic = topicsIn(message.content).find((t) => !excluded.has(t.key));
      if (topic) return topic;
    }
  }
  return undefined;
}

interface SectionIntent {
  pattern: RegExp;
  sections: string[];
  label: string;
}

/** Questions answered by quoting a well-known section of the most recent note that has it. */
const SECTION_INTENTS: SectionIntent[] = [
  { pattern: /allerg/i, sections: ["ALLERGIES"], label: "Allergies" },
  { pattern: /\b(medications?|meds|home meds|taking)\b/i, sections: ["MEDICATIONS", "CURRENT MEDICATIONS", "HOME MEDICATIONS", "DISCHARGE MEDICATIONS"], label: "Medications" },
  { pattern: /performance status|\becog\b|karnofsky|functional status/i, sections: ["PERFORMANCE STATUS"], label: "Performance status" },
  { pattern: /family history/i, sections: ["FAMILY HISTORY"], label: "Family history" },
  { pattern: /social history|\bsmok|alcohol|occupation/i, sections: ["SOCIAL HISTORY"], label: "Social history" },
  { pattern: /past medical|comorbid|medical history/i, sections: ["PAST MEDICAL HISTORY", "PROBLEM LIST"], label: "Past medical history" },
  { pattern: /\bvital|blood pressure|heart rate|\bspo2\b|temperature/i, sections: ["VITAL SIGNS"], label: "Vital signs" },
];

export function answerDemoQuestion(ctx: CaseContext, registry: SourceRegistry, rawQuestion: string): CaseAnswer {
  const question = rawQuestion.replace(/@ai\b/gi, "").trim();
  const citer = new Citer(registry);
  const lines: string[] = [];
  let confidence: AIConfidence = "moderate";
  let limitation = "";

  const topics = topicsIn(question);
  const isCompare = /\bcompar|\bversus\b|\bvs\.?\b|difference between|correlat|consistent with|line up/i.test(question);
  const isSummary = /summar|overview|key findings|what (does|did) .{0,40}(show|say|report)|findings|bring me up to speed/i.test(question);
  const isWhy = /^\s*why\b|\breason|rationale|why (was|is|did|were)/i.test(question);
  const isRisk = /\brisks?\b|watch (for|out)|monitor|concern|red flag|overnight/i.test(question);
  const isPending = /\bpending|outstanding|open tasks?|to-?do|next steps?|what('?s| is) left|follow[- ]?up/i.test(question);
  const isMissing = /\bmissing|lacking|gaps?\b|what else do we need|not yet (done|available)/i.test(question);
  const analyte = detectAnalyte(question);
  const sectionIntent = SECTION_INTENTS.find((intent) => intent.pattern.test(question));
  const isOverview = /\b(case summary|overview|where are we|what do we know|bring me up to speed|summari[sz]e (the |this )?(case|patient))\b/i.test(question);

  if (isCompare && topics.length >= 1) {
    const [first, second] =
      topics.length >= 2 ? [topics[0]!, topics[1]!] : [previousTopic(ctx, question, topics) ?? topics[0]!, topics[0]!];
    const docs = [latestFor(ctx, first), latestFor(ctx, second)].filter((d): d is ContextDocument => Boolean(d));
    const unique = docs.filter((doc, index) => docs.findIndex((d) => d.id === doc.id) === index);
    if (unique.length >= 2) {
      for (const doc of unique) {
        const sentences = gistSentences(doc, 2);
        lines.push(`- ${doc.title} (${shortDate(doc.date)}): ${sentences.join(" ")} ${citer.cite(doc.id, sentences[0])}`);
      }
      const kinds = new Set(unique.map((d) => d.type));
      if (kinds.has("PATHOLOGY_REPORT") && kinds.has("IMAGING_REPORT")) {
        lines.push("Side by side: the pathology provides the tissue diagnosis of the lesion, while the imaging report describes its size and extent, including any vascular involvement. How these combine into a resectability or treatment assessment is for the team to determine.");
      }
      confidence = "high";
      limitation = "Juxtaposes the documented findings; it does not add interpretation.";
    } else {
      lines.push(`I could only find ${unique.length === 1 ? `one of the two records (${unique[0]!.title})` : "neither record"} needed for this comparison in the case documents.`);
      confidence = "insufficient";
    }
  } else if (sectionIntent && !isCompare) {
    const found = byDateAsc(ctx.documents)
      .map((doc) => ({ doc, section: findSection(parseSections(doc.text), sectionIntent.sections) }))
      .filter((entry) => entry.section)
      .at(-1);
    if (found?.section) {
      const sentences = splitSentences(found.section.body);
      lines.push(`${sectionIntent.label}, as documented in the ${lowerFirst(found.doc.title)} (${shortDate(found.doc.date)}): ${sentences.join(" ")} ${citer.cite(found.doc.id, sentences[0])}`);
      confidence = "high";
      limitation = "Quoted from the most recent note containing this section; later changes may not be documented yet.";
    } else {
      lines.push(`No "${sectionIntent.label.toLowerCase()}" section was found in the ${ctx.documents.length} documents of this case.`);
      confidence = "insufficient";
    }
  } else if (analyte && !isSummary) {
    const series = labSeries(ctx, analyte);
    const last = series.at(-1);
    if (last) {
      lines.push(`Latest ${analyte.label}: ${last.value}${last.unit ? ` ${last.unit}` : ""} on ${shortDate(last.date)} ${citer.cite(last.documentId, last.excerpt)}.`);
      if (series.length > 1) {
        const markers = series.slice(-4).map((p) => citer.cite(p.documentId, p.excerpt)).join("");
        lines.push(`Trend: ${series.slice(-4).map((p) => `${p.value} (${shortDate(p.date)})`).join(" → ")}${last.unit ? ` ${last.unit}` : ""} ${markers}.`);
      }
      confidence = "high";
      limitation = "Values are taken verbatim from lab reports and notes; reference ranges may differ between reports.";
    } else {
      lines.push(`No ${analyte.label} result is documented in the case record.`);
      confidence = "insufficient";
    }
  } else if (isMissing) {
    const missing = buildMissingInformation(ctx);
    if (missing.length) {
      lines.push("Items not found in the case record:");
      for (const item of missing) lines.push(`- ${item.item}: ${item.reason}`);
      confidence = "moderate";
      limitation = "Based on a checklist for this case type; absence may reflect records not yet uploaded.";
    } else {
      lines.push("The standard checklist items for this case type are all present in the record.");
      confidence = "moderate";
    }
  } else if (isRisk) {
    const handoff = buildHandoff(ctx, registry);
    const risks = handoff.sections.find((s) => s.key === "risks");
    const pending = handoff.sections.find((s) => s.key === "pending");
    if (risks && risks.body !== "Not documented.") {
      lines.push("Documented risks to watch:");
      lines.push(remap(risks.body, risks.sources, citer));
      const pendingResults = pending?.body
        .split("\n")
        .filter((line) => line.trim() && !line.startsWith("- Task:"))
        .join("\n");
      if (pending && pendingResults) {
        lines.push("Still pending:");
        lines.push(remap(pendingResults, pending.sources, citer));
      }
      confidence = "moderate";
      limitation = "Lists risks as documented by the team; it is not a clinical risk assessment.";
    } else {
      lines.push("No specific risks are documented in the recent records.");
      confidence = "insufficient";
    }
  } else if (isPending) {
    const open = ctx.tasks.filter((t) => t.status !== "DONE");
    for (const task of open) {
      lines.push(`- Task: ${task.title}${task.assignee ? ` (${task.assignee})` : ""}${task.dueDate ? `, due ${shortDate(task.dueDate)}` : ""} ${citer.cite(task.id)}`);
    }
    for (const decision of ctx.decisions.filter((d) => d.status === "PROPOSED" || d.status === "UNDER_REVIEW")) {
      const waiting = decision.approvals.filter((a) => a.status !== "APPROVED").map((a) => `${a.reviewer} (${APPROVAL_STATUS_LABELS[a.status].toLowerCase()})`);
      lines.push(`- Decision #${decision.number} "${decision.title}" is ${DECISION_STATUS_LABELS[decision.status].toLowerCase()}${waiting.length ? `; waiting on ${waiting.join(", ")}` : ""} ${citer.cite(decision.id)}`);
    }
    const note = byDateAsc(ctx.documents).filter((d) => findSection(parseSections(d.text), ["PENDING"])).at(-1);
    const pendingSection = note ? findSection(parseSections(note.text), ["PENDING"]) : undefined;
    if (note && pendingSection) {
      for (const item of listItems(pendingSection.body)) lines.push(`- ${item} ${citer.cite(note.id, item)}`);
    }
    if (lines.length) {
      lines.unshift("Open items in this case:");
      confidence = "high";
    } else {
      lines.push("There are no open tasks, pending decisions or pending results documented.");
      confidence = "moderate";
    }
  } else if (isWhy) {
    const terms = new Set(tokenize(question, { expand: true }));
    const decision = [...ctx.decisions]
      .map((d) => ({ d, overlap: tokenize(`${d.title} ${d.description} ${d.rationale}`, { expand: true }).filter((t) => terms.has(t)).length }))
      .sort((a, b) => b.overlap - a.overlap)[0];
    if (decision && decision.overlap > 0) {
      const d = decision.d;
      const rationale = firstSentences(d.rationale, 3);
      lines.push(`Decision #${d.number} "${d.title}" (${DECISION_STATUS_LABELS[d.status].toLowerCase()}), proposed by ${d.proposedBy}. Documented rationale: ${rationale} ${citer.cite(d.id, firstSentences(d.rationale, 1))}`);
    }
    for (const hit of bestSentences(ctx, question, 3)) {
      lines.push(`- ${hit.label} (${shortDate(hit.date)}): "${hit.sentence}" ${citer.cite(hit.recordId, hit.sentence)}`);
    }
    confidence = lines.length ? (decision && decision.overlap > 0 ? "high" : "moderate") : "insufficient";
    limitation = "Reports the reasons documented by the team; it does not evaluate them.";
  } else if (isSummary && topics.length >= 1) {
    const doc = latestFor(ctx, topics[0]!);
    if (doc) {
      const sentences = gistSentences(doc, 3);
      lines.push(`The ${lowerFirst(doc.title)} (${shortDate(doc.date)}) reports:`);
      for (const sentence of sentences) lines.push(`- ${sentence} ${citer.cite(doc.id, sentence)}`);
      confidence = "high";
      limitation = "Summarizes the key sections of the most recent matching report; earlier reports may contain additional detail.";
    } else {
      lines.push(`No ${topics[0]!.label} report is present in the case record.`);
      confidence = "insufficient";
    }
  } else if (isOverview || (isSummary && topics.length === 0)) {
    const summary = buildCaseSummary(ctx, registry);
    lines.push(summary.headline);
    lines.push(summary.currentStatus);
    for (const finding of summary.keyFindings.slice(0, 4)) {
      const source = finding.sources[0];
      lines.push(`- ${finding.text} ${source ? citer.cite(source.id, finding.text) : ""}`);
    }
    confidence = "moderate";
    limitation = "Condensed from the most recent notes and key reports.";
  } else {
    const hits = bestSentences(ctx, question, 4);
    const required = Math.min(2, Math.max(1, conceptCount(question)));
    const strong = hits
      .filter((hit) => hit.overlap >= required)
      .slice(0, 3)
      .sort((a, b) => b.date.localeCompare(a.date));
    if (strong.length) {
      lines.push("Relevant documentation in the case record (most recent first):");
      for (const hit of strong) lines.push(`- ${hit.label} (${shortDate(hit.date)}): "${hit.sentence}" ${citer.cite(hit.recordId, hit.sentence)}`);
      confidence = strong.length >= 2 ? "moderate" : "low";
      limitation = "Retrieved by keyword relevance; the record may address this question elsewhere.";
    } else {
      lines.push(`I could not find information in the case record that answers this question (${ctx.documents.length} documents searched).`);
      confidence = "insufficient";
    }
  }

  if (confidence === "insufficient") {
    limitation = "The case record does not contain enough information to answer; consider uploading the relevant records.";
  }

  return {
    answer: lines.join("\n").replace(/[ \t]+\n/g, "\n").trim(),
    sources: citer.sources,
    confidence,
    limitations: `${limitation} ${DEMO_LIMITATIONS}`.trim(),
    droppedCitations: 0,
  };
}

/** Re-number markers from a pre-built section into this answer's citer. */
function remap(body: string, sectionSources: CaseAnswer["sources"], citer: Citer): string {
  return body.replace(/\[(\d+)\]/g, (_m, n: string) => {
    const source = sectionSources[Number(n) - 1];
    return source ? citer.cite(source.id, source.excerpt ?? undefined) : "";
  });
}
