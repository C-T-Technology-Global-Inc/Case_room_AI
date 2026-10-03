import type { CaseMemory, ContextDocument, LabFlag, TreatmentStatus } from "@ccr/types";
import { emptyCaseMemory } from "@ccr/types";

/**
 * Facts extracted from one document. Produced either by the LLM
 * (structured output) or by the offline demo extractor.
 */
export interface MemoryFacts {
  diagnoses: Array<{ name: string; detail: string }>;
  medications: Array<{ name: string; detail: string }>;
  labs: Array<{ name: string; value: string; flag: LabFlag }>;
  imaging: Array<{ study: string; finding: string }>;
  pathology: Array<{ finding: string }>;
  treatments: Array<{ name: string; status: TreatmentStatus; detail: string }>;
  problems: string[];
  openQuestions: string[];
}

export function emptyMemoryFacts(): MemoryFacts {
  return {
    diagnoses: [],
    medications: [],
    labs: [],
    imaging: [],
    pathology: [],
    treatments: [],
    problems: [],
    openQuestions: [],
  };
}

const MAX_PROBLEMS = 12;
const MAX_QUESTIONS = 10;
const MAX_LABS = 60;

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Insert or replace by key; the newer (later-dated) entry wins. */
function upsertBy<T extends { date: string | null }>(list: T[], entry: T, key: (item: T) => string): T[] {
  const k = key(entry);
  const index = list.findIndex((item) => key(item) === k);
  if (index === -1) return [...list, entry];
  const existing = list[index]!;
  if ((existing.date ?? "") > (entry.date ?? "")) return list;
  const next = [...list];
  next[index] = entry;
  return next;
}

function unionStrings(existing: string[], incoming: string[], max: number): string[] {
  const seen = new Set(existing.map(norm));
  const result = [...existing];
  for (const value of incoming) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(norm(trimmed))) continue;
    seen.add(norm(trimmed));
    result.push(trimmed);
  }
  return result.slice(-max);
}

/**
 * Fold the facts extracted from `document` into the shared memory.
 * Idempotent per document: re-processing a document replaces nothing twice
 * because entries are keyed by name/study + date.
 */
export function mergeMemoryFacts(
  memory: CaseMemory | null,
  facts: MemoryFacts,
  document: Pick<ContextDocument, "id" | "date">,
  now: Date = new Date(),
): CaseMemory {
  const next: CaseMemory = memory ? structuredClone(memory) : emptyCaseMemory(now);
  const date = document.date;
  const sourceDocumentId = document.id;

  for (const diagnosis of facts.diagnoses) {
    next.diagnoses = upsertBy(next.diagnoses, { ...diagnosis, date, sourceDocumentId }, (d) => norm(d.name));
  }
  for (const medication of facts.medications) {
    next.medications = upsertBy(next.medications, { ...medication, date, sourceDocumentId }, (m) => norm(m.name));
  }
  for (const treatment of facts.treatments) {
    next.treatments = upsertBy(next.treatments, { ...treatment, date, sourceDocumentId }, (t) => norm(t.name));
  }
  for (const lab of facts.labs) {
    next.importantLabs = upsertBy(next.importantLabs, { ...lab, date, sourceDocumentId }, (l) => `${norm(l.name)}|${l.date}`);
  }
  next.importantLabs = [...next.importantLabs]
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    .slice(-MAX_LABS);
  for (const study of facts.imaging) {
    next.importantImaging = upsertBy(next.importantImaging, { ...study, date, sourceDocumentId }, (i) => `${norm(i.study)}|${i.date}`);
  }
  for (const finding of facts.pathology) {
    next.pathology = upsertBy(next.pathology, { ...finding, date, sourceDocumentId }, (p) => `${norm(p.finding).slice(0, 60)}|${p.date}`);
  }
  next.activeProblems = unionStrings(next.activeProblems, facts.problems, MAX_PROBLEMS);
  next.openQuestions = unionStrings(next.openQuestions, facts.openQuestions, MAX_QUESTIONS);

  if (!next.processedDocumentIds.includes(document.id)) {
    next.processedDocumentIds = [...next.processedDocumentIds, document.id];
  }
  next.updatedAt = now.toISOString();
  return next;
}

/** Remove everything contributed by a document (used when re-processing). */
export function removeDocumentFromMemory(memory: CaseMemory, documentId: string): CaseMemory {
  const keep = <T extends { sourceDocumentId: string | null }>(list: T[]) =>
    list.filter((item) => item.sourceDocumentId !== documentId);
  return {
    ...memory,
    diagnoses: keep(memory.diagnoses),
    medications: keep(memory.medications),
    importantLabs: keep(memory.importantLabs),
    importantImaging: keep(memory.importantImaging),
    pathology: keep(memory.pathology),
    treatments: keep(memory.treatments),
    processedDocumentIds: memory.processedDocumentIds.filter((id) => id !== documentId),
  };
}
