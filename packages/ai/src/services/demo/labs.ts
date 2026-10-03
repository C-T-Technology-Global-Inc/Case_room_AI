import type { CaseContext, LabFlag } from "@ccr/types";
import { parseLabs } from "./clinical-text";

/**
 * Lab value series across all documents of a case: tabular results from lab
 * reports plus inline mentions in notes ("hemoglobin 9.6 g/dL").
 */

export interface Analyte {
  key: string;
  label: string;
  /** Matches the test name column of a lab table. */
  name: RegExp;
  /** Matches a mention in the question text. */
  question: RegExp;
  /** Captures (value, unit) from free text. */
  inline?: RegExp;
}

const SEP = String.raw`\s*(?:of|was|is|at|now|:|=)?\s*`;

export const ANALYTES: Analyte[] = [
  { key: "hemoglobin", label: "Hemoglobin", name: /^(hemoglobin|hgb|hb)$/i, question: /\b(hemoglobin|haemoglobin|hgb|hb)\b/i, inline: new RegExp(String.raw`\b(?:hemoglobin|hgb)${SEP}(\d{1,2}(?:\.\d)?)\s*(g/dL)`, "gi") },
  { key: "ca19-9", label: "CA 19-9", name: /ca\s*19-?9/i, question: /ca\s*19-?9/i, inline: new RegExp(String.raw`\bca\s*19-?9${SEP}([\d,]+(?:\.\d+)?)\s*(U/mL)`, "gi") },
  { key: "cea", label: "CEA", name: /^cea$/i, question: /\bcea\b/i },
  { key: "ca-125", label: "CA-125", name: /ca-?125/i, question: /ca-?125/i },
  { key: "bilirubin", label: "Total bilirubin", name: /^(total )?bilirubin$/i, question: /bilirubin/i, inline: new RegExp(String.raw`\b(?:total )?bilirubin${SEP}(\d{1,2}(?:\.\d)?)\s*(mg/dL)`, "gi") },
  { key: "wbc", label: "White blood cells", name: /^(wbc|white blood cells?|leukocytes?)$/i, question: /\b(wbc|white (blood )?count|white blood cells?|leukocyt\w*)\b/i, inline: new RegExp(String.raw`\b(?:wbc|white blood cells?)${SEP}(\d{1,2}(?:\.\d)?)\s*(x10\^3/uL)`, "gi") },
  { key: "platelets", label: "Platelets", name: /^platelets?$/i, question: /platelet/i },
  { key: "creatinine", label: "Creatinine", name: /^creatinine$/i, question: /creatinine|kidney function|renal function/i, inline: new RegExp(String.raw`\bcreatinine${SEP}(\d(?:\.\d{1,2})?)\s*(mg/dL)`, "gi") },
  { key: "lactate", label: "Lactate", name: /^lactate$/i, question: /lactate/i, inline: new RegExp(String.raw`\blactate${SEP}(\d{1,2}(?:\.\d)?)\s*(mmol/L)`, "gi") },
  { key: "bnp", label: "NT-proBNP", name: /(nt-?pro)?bnp/i, question: /\b(nt-?pro)?bnp\b/i, inline: new RegExp(String.raw`\b(?:nt-?pro)?bnp${SEP}([\d,]+)\s*(pg/mL)`, "gi") },
  { key: "troponin", label: "Troponin", name: /troponin/i, question: /troponin/i },
  { key: "sodium", label: "Sodium", name: /^sodium$/i, question: /\bsodium\b/i },
  { key: "potassium", label: "Potassium", name: /^potassium$/i, question: /potassium/i },
  { key: "albumin", label: "Albumin", name: /^albumin$/i, question: /albumin/i },
  { key: "inr", label: "INR", name: /^inr$/i, question: /\binr\b/i },
];

export interface LabPoint {
  analyte: string;
  value: string;
  numeric: number | null;
  unit: string;
  flag: LabFlag;
  date: string;
  documentId: string;
  /** Verbatim text from the source that contains the value. */
  excerpt: string;
}

export function detectAnalyte(text: string): Analyte | undefined {
  return ANALYTES.find((analyte) => analyte.question.test(text));
}

export function labSeries(ctx: CaseContext, analyte: Analyte): LabPoint[] {
  const points: LabPoint[] = [];
  // Lab reports first (authoritative tables), then notes in date order; a note
  // that repeats an already-known value is a historical mention, not a new result.
  const ordered = [...ctx.documents].sort(
    (a, b) => Number(b.type === "LAB_RESULT") - Number(a.type === "LAB_RESULT") || a.date.localeCompare(b.date),
  );
  for (const doc of ordered) {
    if (doc.type === "LAB_RESULT") {
      for (const lab of parseLabs(doc.text)) {
        if (!analyte.name.test(lab.name)) continue;
        const line = doc.text.split(/\r?\n/).find((l) => l.includes(lab.name) && l.includes(lab.value)) ?? "";
        points.push({
          analyte: analyte.label,
          value: lab.value,
          numeric: lab.numeric,
          unit: lab.unit,
          flag: lab.flag,
          date: doc.date,
          documentId: doc.id,
          excerpt: line.trim().replace(/\s{2,}/g, " "),
        });
      }
    }
    // Tables in lab reports are parsed above; inline mentions are only read from notes.
    if (analyte.inline && doc.type !== "LAB_RESULT") {
      for (const match of doc.text.matchAll(analyte.inline)) {
        const value = match[1]!;
        if (points.some((p) => p.value === value)) continue;
        points.push({
          analyte: analyte.label,
          value,
          numeric: Number.parseFloat(value.replace(/,/g, "")),
          unit: match[2] ?? "",
          flag: "unknown",
          date: doc.date,
          documentId: doc.id,
          excerpt: match[0],
        });
      }
    }
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

export function describeTrend(points: LabPoint[], max = 4): string {
  const recent = points.slice(-max);
  const unit = recent.at(-1)?.unit ?? "";
  return `${recent.map((p) => p.value).join(" → ")}${unit ? ` ${unit}` : ""}`;
}

/** Relative change between first and last point of the series (null if not numeric). */
export function relativeChange(points: LabPoint[]): number | null {
  const first = points[0]?.numeric;
  const last = points.at(-1)?.numeric;
  if (first == null || last == null || first === 0) return null;
  return (last - first) / Math.abs(first);
}

/** Flag for the latest point; inline mentions borrow the flag of the latest tabular result. */
export function latestFlag(points: LabPoint[]): LabPoint["flag"] {
  const last = points.at(-1);
  if (!last) return "unknown";
  if (last.flag !== "unknown") return last.flag;
  return [...points].reverse().find((p) => p.flag !== "unknown")?.flag ?? "unknown";
}
