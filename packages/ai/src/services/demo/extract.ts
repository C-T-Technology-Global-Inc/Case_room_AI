import type { ContextDocument, TimelineEventType, TreatmentStatus } from "@ccr/types";
import { emptyMemoryFacts, type MemoryFacts } from "../../memory/merge";
import type { ExtractedTimelineEvent } from "../types";
import {
  KEY_LABS,
  documentGist,
  findSection,
  firstSentences,
  formatLab,
  listItems,
  parseLabs,
  parseSections,
  pathologyDiagnoses,
  splitSentences,
  type LabValue,
} from "./clinical-text";

/** Document-level extraction for the offline demo engine. */

export function classifyEventType(doc: Pick<ContextDocument, "type" | "title">): TimelineEventType {
  switch (doc.type) {
    case "IMAGING_REPORT":
      return "IMAGING";
    case "LAB_RESULT":
      return "LAB";
    case "PATHOLOGY_REPORT":
      return "PATHOLOGY";
    case "DISCHARGE_SUMMARY":
      return "DISCHARGE";
    default:
      break;
  }
  const title = doc.title.toLowerCase();
  if (/procedure|biopsy|ercp|\beus\b|endoscop|operative|resection|placement|catheter/.test(title)) return "PROCEDURE";
  if (/admission|admit|h&p|history and physical/.test(title)) return "ADMISSION";
  if (/consult/.test(title)) return "CONSULTATION";
  if (/chemo|radiation|infusion|cycle|treatment/.test(title)) return "TREATMENT";
  if (/tumor board|decision/.test(title)) return "DECISION";
  return "NOTE";
}

const TUMOR_MARKERS = /ca\s*19-9|cea|ca-?125|psa|afp|nt-?probnp|bnp|troponin/i;

function labPriority(lab: LabValue): number {
  if (TUMOR_MARKERS.test(lab.name)) return 0;
  if (lab.flag === "critical") return 1;
  if (KEY_LABS.test(lab.name)) return 2;
  return 3;
}

function abnormalLabs(doc: ContextDocument): LabValue[] {
  return parseLabs(doc.text)
    .filter((lab) => lab.flag !== "normal")
    .sort((a, b) => labPriority(a) - labPriority(b));
}

const MALIGNANCY = /((?:[a-z]+\s)?(?:ductal |squamous cell |small cell |large b-cell |invasive )?(?:adeno)?carcinoma|lymphoma|melanoma|sarcoma|myeloma|leukemia|malignan\w+)/i;

function pathologyDiagnosis(doc: ContextDocument): string {
  return pathologyDiagnoses(doc.text, 2).join(" ");
}

export function timelineEventsForDocument(doc: ContextDocument): ExtractedTimelineEvent[] {
  const eventType = classifyEventType(doc);
  let title = doc.title;
  let description = documentGist(doc, 2);

  if (doc.type === "LAB_RESULT") {
    const labs = parseLabs(doc.text);
    const abnormal = abnormalLabs(doc);
    const top = abnormal[0];
    if (top && (TUMOR_MARKERS.test(top.name) || KEY_LABS.test(top.name))) {
      title = `${top.name} ${top.flag === "low" ? "decreased" : "elevated"}`;
    } else if (labs.length > 0 && abnormal.length === 0) {
      title = `${doc.title}: within reference ranges`;
    }
    if (abnormal.length) description = `${abnormal.slice(0, 5).map(formatLab).join("; ")}.`;
    const sections = parseSections(doc.text);
    const micro = findSection(sections, ["MICROBIOLOGY", "CULTURE"]);
    if (micro) description += ` ${firstSentences(micro.body, 1)}`;
  } else if (doc.type === "PATHOLOGY_REPORT") {
    const diagnosis = pathologyDiagnosis(doc);
    const malignancy = MALIGNANCY.exec(diagnosis)?.[1];
    title = malignancy ? `Pathology confirms ${malignancy.trim().toLowerCase()}` : "Pathology reported";
    description = diagnosis;
  } else if (doc.type === "IMAGING_REPORT") {
    const impression = findSection(parseSections(doc.text), ["IMPRESSION", "CONCLUSION"]);
    if (impression) {
      const items = listItems(impression.body);
      description = items.length ? items.slice(0, 2).join(" ") : firstSentences(impression.body, 2);
    }
  }

  return [
    {
      date: doc.date,
      eventType,
      title: truncate(title, 90),
      description: truncate(description, 420),
      sourceDocumentId: doc.id,
    },
  ];
}

// ── Memory facts ────────────────────────────────────────────────────────────

const TREATMENTS: Array<[RegExp, string]> = [
  [/folfirinox/i, "FOLFIRINOX chemotherapy"],
  [/folfox|bevacizumab/i, "FOLFOX + bevacizumab"],
  [/tchp|trastuzumab|pertuzumab/i, "HER2-directed chemotherapy"],
  [/gemcitabine/i, "Gemcitabine-based chemotherapy"],
  [/chemoimmunotherapy|pembrolizumab|nivolumab|immunotherapy/i, "Immunotherapy-based treatment"],
  [/neoadjuvant (systemic )?(chemotherapy|therapy)/i, "Neoadjuvant chemotherapy"],
  [/chemoradiation|chemoradiotherapy/i, "Chemoradiation"],
  [/\bsbrt\b|stereotactic/i, "Stereotactic body radiotherapy"],
  [/pancreaticoduodenectomy|whipple/i, "Pancreaticoduodenectomy"],
  [/lobectomy/i, "Lobectomy"],
  [/mastectomy|lumpectomy/i, "Breast surgery"],
  [/biliary stent|metal stent/i, "Biliary stent"],
  [/sphincterotomy/i, "Biliary sphincterotomy"],
  [/piperacillin|antibiotic/i, "IV antibiotics"],
  [/enoxaparin|heparin|anticoagula/i, "VTE prophylaxis / anticoagulation"],
  [/furosemide|diures/i, "IV diuresis"],
  [/port placement/i, "Port placement"],
];

function treatmentStatus(sentence: string): TreatmentStatus {
  if (/\b(held|hold|holding|on hold|discontinued|stopped)\b/i.test(sentence)) return "held";
  if (/\b(recommend|recommended|plan|planned|favor|consider|will|pending|prior to|before|required|re-evaluate|if\b|once\b|in \d+ hours)/i.test(sentence)) return "planned";
  if (/\b(completed|s\/p|status post|was placed|were placed|was performed|placed|performed)\b/i.test(sentence)) return "completed";
  if (/\b(started|continue|continuing|receiving|resumed|ongoing|on iv|initiated)\b/i.test(sentence)) return "active";
  return "unknown";
}

const DIAGNOSIS_TERMS = /(acute [a-z]+(?:itis| failure| injury)|[a-z]+itis\b|heart failure[^,.;]*|sepsis|carcinoma[^,.;]*|adenocarcinoma[^,.;]*|cardiomyopathy|pneumonia|obstruction[^,.;]*)/i;

export function memoryFactsForDocument(doc: ContextDocument): MemoryFacts {
  const facts = emptyMemoryFacts();
  const sections = parseSections(doc.text);

  if (doc.type === "LAB_RESULT") {
    for (const lab of parseLabs(doc.text)) {
      if (lab.flag !== "normal" || KEY_LABS.test(lab.name)) {
        facts.labs.push({ name: lab.name, value: `${lab.value}${lab.unit ? ` ${lab.unit}` : ""}`, flag: lab.flag });
      }
    }
  }

  if (doc.type === "IMAGING_REPORT") {
    const impression = findSection(sections, ["IMPRESSION", "CONCLUSION", "FINDINGS"]);
    const items = impression ? listItems(impression.body) : [];
    const finding = items.length ? items.slice(0, 2).join(" ") : firstSentences(impression?.body ?? doc.text, 2);
    facts.imaging.push({ study: doc.title, finding: truncate(finding, 400) });
  }

  if (doc.type === "PATHOLOGY_REPORT") {
    const diagnosis = pathologyDiagnosis(doc);
    facts.pathology.push({ finding: truncate(diagnosis, 300) });
    const consistentWith = /consistent with ([^.;]+)/i.exec(diagnosis)?.[1];
    const name = consistentWith ?? MALIGNANCY.exec(diagnosis)?.[1] ?? diagnosis;
    facts.diagnoses.push({ name: capitalize(name.trim()), detail: truncate(diagnosis, 200) });
    const comment = findSection(sections, ["COMMENT"]);
    for (const sentence of splitSentences(comment?.body ?? "")) {
      if (/recommend/i.test(sentence)) facts.openQuestions.push(truncate(sentence, 200));
    }
  }

  if (doc.type === "CLINICAL_NOTE" || doc.type === "DISCHARGE_SUMMARY" || doc.type === "OTHER") {
    const medications = findSection(sections, ["MEDICATIONS", "CURRENT MEDICATIONS", "HOME MEDICATIONS", "DISCHARGE MEDICATIONS"]);
    if (medications) {
      for (const entry of medications.body.split(/(?<=\.)\s+|\n|;/)) {
        const cleaned = entry.replace(/^[-•*]\s*/, "").replace(/\.$/, "").trim();
        if (!cleaned || /no known|none/i.test(cleaned)) continue;
        const match = /^([A-Za-z][A-Za-z-]+(?:\s[A-Za-z-]+)?)\s*(.*)$/.exec(cleaned);
        if (match) facts.medications.push({ name: match[1]!, detail: match[2] ?? "" });
      }
    }

    const history = findSection(sections, ["PAST MEDICAL HISTORY", "PROBLEM LIST"]);
    if (history) {
      for (const item of history.body.split(/(?<=\.)\s+|\n|;/)) {
        const cleaned = item.replace(/^[-•*\d.)\s]+/, "").replace(/\.$/, "").trim();
        if (cleaned.length > 2 && cleaned.length < 80) facts.problems.push(cleaned);
      }
    }

    const assessment = findSection(sections, ["ASSESSMENT AND PLAN", "ASSESSMENT", "IMPRESSION"]);
    if (assessment) {
      const first = firstSentences(assessment.body, 1);
      const diagnosis = DIAGNOSIS_TERMS.exec(first)?.[1];
      if (diagnosis) {
        facts.diagnoses.push({ name: capitalize(diagnosis.trim()), detail: truncate(first, 220) });
        facts.problems.push(capitalize(diagnosis.trim()));
      }
    }

    const planLike = sections.filter((section) =>
      /PLAN|RECOMMENDATION|INTERVENTION|ACTIONS|ASSESSMENT/.test(section.heading),
    );
    const seen = new Set<string>();
    for (const section of planLike) {
      for (const sentence of [...listItems(section.body), ...splitSentences(section.body)]) {
        for (const [pattern, name] of TREATMENTS) {
          if (!pattern.test(sentence) || seen.has(name)) continue;
          seen.add(name);
          facts.treatments.push({ name, status: treatmentStatus(sentence), detail: truncate(sentence, 200) });
        }
      }
    }

    const questions = findSection(sections, ["QUESTIONS FOR TUMOR BOARD", "OPEN QUESTIONS", "QUESTIONS"]);
    if (questions) facts.openQuestions.push(...listItems(questions.body));
  }

  return facts;
}

export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
