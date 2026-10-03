import type { ContextDocument, DocumentType, LabFlag } from "@ccr/types";

/**
 * Deterministic text utilities used by the offline demo engine. They work on
 * the conventional structure of clinical documents (UPPERCASE HEADINGS:,
 * sentences, tabular lab results). No model is involved.
 */

export interface Section {
  heading: string;
  body: string;
}

const HEADING_LINE = /^\s*([A-Z][A-Z0-9 /&(),'+-]{2,60}):\s*(.*)$/;

export function parseSections(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { heading: "PREAMBLE", body: "" };
  for (const line of text.split(/\r?\n/)) {
    const match = HEADING_LINE.exec(line);
    // Require at least one letter run of 3+ uppercase letters to avoid matching "CA 19-9: 1240".
    if (match && /[A-Z]{3,}/.test(match[1]!) && !/\d{2,}/.test(match[1]!)) {
      if (current.body.trim() || current.heading !== "PREAMBLE") sections.push(current);
      current = { heading: match[1]!.trim(), body: match[2] ?? "" };
    } else {
      current.body += (current.body ? "\n" : "") + line;
    }
  }
  sections.push(current);
  return sections
    .map((section) => ({ heading: section.heading, body: section.body.trim() }))
    .filter((section) => section.body.length > 0);
}

export function findSection(sections: Section[], names: string[]): Section | undefined {
  for (const name of names) {
    const found = sections.find((section) => section.heading === name);
    if (found) return found;
  }
  for (const name of names) {
    const found = sections.find((section) => section.heading.includes(name));
    if (found) return found;
  }
  return undefined;
}

const ABBREVIATIONS = [
  "Dr", "Mr", "Mrs", "Ms", "vs", "e.g", "i.e", "approx", "St", "No", "Fig", "min", "max", "ca", "cf", "etc", "Pt", "pt", "Hx", "hx",
];

export function splitSentences(text: string): string[] {
  let protectedText = text.replace(/\s*\n\s*(?=[-•*]|\d+[.)]\s)/g, "\n");
  for (const abbreviation of ABBREVIATIONS) {
    const pattern = new RegExp(`\\b${abbreviation.replace(".", "\\.")}\\.`, "g");
    protectedText = protectedText.replace(pattern, `${abbreviation.replace(".", "\u0001")}\u0001`);
  }
  // Protect decimals like 3.8 and list numbering like "1."
  protectedText = protectedText.replace(/(\d)\.(\d)/g, "$1\u0001$2");

  return protectedText
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"(])|\n+/)
    .map((sentence) => sentence.replace(/\u0001/g, ".").replace(/^[-•*]\s*/, "").replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length > 2);
}

export function firstSentences(text: string, count: number): string {
  return splitSentences(text).slice(0, count).join(" ");
}

/** Lines that look like list items ("- x", "• x", "1. x", "1) x"). */
export function listItems(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^([-•*]|\d+[.)])\s+/.test(line))
    .map((line) => line.replace(/^([-•*]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

export function containsAny(text: string, words: Array<string | RegExp>): boolean {
  const lower = text.toLowerCase();
  return words.some((word) => (typeof word === "string" ? lower.includes(word) : word.test(text)));
}

export function sentencesMatching(text: string, pattern: RegExp, limit = 3): string[] {
  return splitSentences(text)
    .filter((sentence) => pattern.test(sentence))
    .slice(0, limit);
}

// ── Labs ──────────────────────────────────────────────────────────────────

export interface LabValue {
  name: string;
  value: string;
  unit: string;
  reference: string | null;
  flag: LabFlag;
  /** Numeric value when parseable (for trends). */
  numeric: number | null;
}

const FLAG_MAP: Record<string, LabFlag> = {
  H: "high",
  HIGH: "high",
  "*H": "high",
  L: "low",
  LOW: "low",
  "*L": "low",
  HH: "critical",
  LL: "critical",
  C: "critical",
  CRIT: "critical",
  CRITICAL: "critical",
  A: "abnormal",
  ABN: "abnormal",
  ABNORMAL: "abnormal",
};

const VALUE = /^[<>]?\s?-?\d[\d,]*(\.\d+)?$|^(positive|negative|pending|detected|not detected|reactive|nonreactive)$/i;
const RANGE = /^([<>]=?\s?\d|\d[\d,.]*\s?-\s?\d|negative|non-?reactive)/i;

export function parseLabs(text: string): LabValue[] {
  const results: LabValue[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, "  ").trimEnd();
    if (!line.trim() || /^\s*(TEST|ANALYTE|COMPONENT)\b/i.test(line)) continue;

    const columns = line.trim().split(/\s{2,}/);
    if (columns.length >= 2 && /^[A-Za-z]/.test(columns[0]!) && VALUE.test(columns[1]!.trim())) {
      const [name, value, ...rest] = columns as [string, string, ...string[]];
      let unit = "";
      let reference: string | null = null;
      let flag: LabFlag = "normal";
      // The flag is always the last column; checking only that position keeps
      // units such as "L" (liters) from being read as a "Low" flag.
      const last = rest.at(-1)?.trim().toUpperCase();
      if (last && FLAG_MAP[last]) {
        flag = FLAG_MAP[last]!;
        rest.pop();
      }
      for (const column of rest) {
        const trimmed = column.trim();
        if (!reference && RANGE.test(trimmed)) reference = trimmed;
        else if (!unit) unit = trimmed;
      }
      results.push({ name: name.trim(), value: value.trim(), unit, reference, flag, numeric: toNumber(value) });
      continue;
    }

    const inline = /^\s*([A-Za-z][\w ,.'()/+-]{1,40}?):\s*([<>]?\d[\d,]*\.?\d*)\s*([^\s(]*)\s*(?:\(([^)]*)\))?\s*\b(H|L|HH|LL|HIGH|LOW|CRITICAL)?\b/i.exec(line);
    if (inline && inline[2]) {
      const flagToken = inline[5]?.toUpperCase();
      results.push({
        name: inline[1]!.trim(),
        value: inline[2],
        unit: inline[3] ?? "",
        reference: inline[4] ?? null,
        flag: flagToken ? FLAG_MAP[flagToken] ?? "abnormal" : "normal",
        numeric: toNumber(inline[2]),
      });
    }
  }
  return results;
}

function toNumber(value: string): number | null {
  const cleaned = value.replace(/[<>,\s]/g, "");
  const number = Number.parseFloat(cleaned);
  return Number.isFinite(number) ? number : null;
}

export function formatLab(lab: LabValue): string {
  const flag = lab.flag === "normal" ? "" : ` (${lab.flag === "high" ? "H" : lab.flag === "low" ? "L" : lab.flag})`;
  return `${lab.name} ${lab.value}${lab.unit ? ` ${lab.unit}` : ""}${flag}`;
}

/** Common tumor markers and key labs that are always worth surfacing. */
export const KEY_LABS = /ca\s*19-9|cea|ca-?125|psa|afp|hemoglobin|hgb|platelet|wbc|bilirubin|creatinine|bnp|troponin|lactate|albumin|inr/i;

// ── Document classification ──────────────────────────────────────────────

/** Preferred sections holding the "gist" of each document type. */
const KEY_SECTIONS: Record<DocumentType, string[]> = {
  IMAGING_REPORT: ["IMPRESSION", "CONCLUSION", "FINDINGS"],
  PATHOLOGY_REPORT: ["FINAL DIAGNOSIS", "DIAGNOSIS", "COMMENT", "MICROSCOPIC DESCRIPTION"],
  LAB_RESULT: ["INTERPRETATION", "COMMENT", "RESULTS"],
  CLINICAL_NOTE: ["ASSESSMENT AND PLAN", "ASSESSMENT", "IMPRESSION", "RECOMMENDATIONS", "PLAN", "HISTORY OF PRESENT ILLNESS"],
  DISCHARGE_SUMMARY: ["DISCHARGE DIAGNOSIS", "HOSPITAL COURSE", "ASSESSMENT"],
  OTHER: ["SUMMARY", "ASSESSMENT", "IMPRESSION"],
};

export function keySection(doc: Pick<ContextDocument, "type" | "text">): Section | undefined {
  const sections = parseSections(doc.text);
  return findSection(sections, KEY_SECTIONS[doc.type]) ?? sections.find((section) => section.heading !== "PREAMBLE");
}

/**
 * Split a section body into prose sentences and list items. Assessment-and-plan
 * sections typically start with an assessment sentence followed by a numbered plan.
 */
export function proseAndItems(text: string): { prose: string[]; items: string[] } {
  const lines = text.split(/\r?\n/);
  const isItem = (line: string) => /^\s*([-•*]|\d+[.)])\s+/.test(line);
  return {
    prose: splitSentences(lines.filter((line) => !isItem(line)).join("\n")),
    items: listItems(text),
  };
}

/** The one or two sentences that best summarize a document. */
export function documentGist(doc: Pick<ContextDocument, "type" | "text" | "title">, sentences = 2): string {
  if (doc.type === "LAB_RESULT") {
    const abnormal = parseLabs(doc.text).filter((lab) => lab.flag !== "normal");
    if (abnormal.length) return `Abnormal results: ${abnormal.slice(0, 5).map(formatLab).join("; ")}.`;
  }
  const sections = parseSections(doc.text);
  const section = isNursingNote(doc) ? findSection(sections, ["SITUATION", "ASSESSMENT"]) ?? keySection(doc) : keySection(doc);
  const { prose, items } = proseAndItems(section?.body ?? doc.text);
  return [...prose, ...items].slice(0, sentences).join(" ");
}

export function isNursingNote(doc: Pick<ContextDocument, "title" | "type">): boolean {
  return doc.type === "CLINICAL_NOTE" && /nurs|shift|rn\b/i.test(doc.title);
}

/** Final diagnosis lines of a pathology report, without specimen labels ("A. Left breast, core biopsy: ..."). */
export function pathologyDiagnoses(text: string, max = 2): string[] {
  const section = findSection(parseSections(text), ["FINAL DIAGNOSIS", "DIAGNOSIS"]);
  return splitSentences(section?.body ?? text)
    .map((sentence) => {
      const colon = sentence.lastIndexOf(":");
      return colon > 0 && colon < sentence.length - 10 ? sentence.slice(colon + 1).trim() : sentence;
    })
    .filter((sentence) => sentence.length > 3)
    .slice(0, max);
}
