import { z } from "zod";

/**
 * Shared Patient Memory: a structured, database-backed snapshot of what the
 * care team knows. It is updated incrementally whenever a clinical document is
 * processed, and is part of the context every AI request receives.
 *
 * Decisions and tasks are part of the memory model conceptually, but they are
 * read live from their own tables rather than duplicated into this JSON.
 */

export const LAB_FLAGS = ["normal", "abnormal", "high", "low", "critical", "unknown"] as const;
export type LabFlag = (typeof LAB_FLAGS)[number];

export const TREATMENT_STATUSES = ["planned", "active", "completed", "held", "unknown"] as const;
export type TreatmentStatus = (typeof TREATMENT_STATUSES)[number];

const sourced = {
  date: z.string().nullable(),
  sourceDocumentId: z.string().nullable(),
};

export const caseMemorySchema = z.object({
  patientSummary: z.string(),
  activeProblems: z.array(z.string()),
  diagnoses: z.array(z.object({ name: z.string(), detail: z.string(), ...sourced })),
  medications: z.array(z.object({ name: z.string(), detail: z.string(), ...sourced })),
  importantLabs: z.array(
    z.object({ name: z.string(), value: z.string(), flag: z.enum(LAB_FLAGS), ...sourced }),
  ),
  importantImaging: z.array(z.object({ study: z.string(), finding: z.string(), ...sourced })),
  pathology: z.array(z.object({ finding: z.string(), ...sourced })),
  treatments: z.array(
    z.object({
      name: z.string(),
      status: z.enum(TREATMENT_STATUSES),
      detail: z.string(),
      ...sourced,
    }),
  ),
  openQuestions: z.array(z.string()),
  /** Ids of documents already folded into this memory. */
  processedDocumentIds: z.array(z.string()),
  updatedAt: z.string(),
});
export type CaseMemory = z.infer<typeof caseMemorySchema>;

export function emptyCaseMemory(now: Date = new Date()): CaseMemory {
  return {
    patientSummary: "",
    activeProblems: [],
    diagnoses: [],
    medications: [],
    importantLabs: [],
    importantImaging: [],
    pathology: [],
    treatments: [],
    openQuestions: [],
    processedDocumentIds: [],
    updatedAt: now.toISOString(),
  };
}

/** Parse stored JSON defensively; corrupted memory degrades to empty memory. */
export function parseCaseMemory(value: unknown): CaseMemory | null {
  const parsed = caseMemorySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
