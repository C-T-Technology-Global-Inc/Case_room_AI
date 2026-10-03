import { z } from "zod";
import { sourceRefSchema } from "./sources";

/**
 * Content stored in CaseBrief.content. Two shapes:
 *  - "case_summary": the Overview summary (regenerated, reviewed, not edited)
 *  - "sections":     tumor board brief and handoff (editable section by section)
 */

export const RESULT_FLAGS = ["normal", "abnormal", "critical", "unknown"] as const;
export type ResultFlag = (typeof RESULT_FLAGS)[number];

export const caseSummaryContentSchema = z.object({
  kind: z.literal("case_summary"),
  headline: z.string(),
  currentStatus: z.string(),
  currentDiagnosis: z.string(),
  currentTreatment: z.string(),
  keyFindings: z.array(z.object({ text: z.string(), sources: z.array(sourceRefSchema) })),
  latestResults: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
      date: z.string().nullable(),
      flag: z.enum(RESULT_FLAGS),
      sources: z.array(sourceRefSchema),
    }),
  ),
  outstandingQuestions: z.array(z.string()),
  missingInformation: z.array(
    z.object({ item: z.string(), reason: z.string(), priority: z.enum(["high", "medium", "low"]) }),
  ),
  limitations: z.string(),
});
export type CaseSummaryContent = z.infer<typeof caseSummaryContentSchema>;

export const briefSectionSchema = z.object({
  key: z.string(),
  title: z.string(),
  /** Plain text. Lines starting with "- " render as bullets, "1. " as numbered items. */
  body: z.string(),
  sources: z.array(sourceRefSchema),
});
export type BriefSection = z.infer<typeof briefSectionSchema>;

export const sectionsContentSchema = z.object({
  kind: z.literal("sections"),
  sections: z.array(briefSectionSchema),
  limitations: z.string(),
});
export type SectionsContent = z.infer<typeof sectionsContentSchema>;

export const briefContentSchema = z.discriminatedUnion("kind", [
  caseSummaryContentSchema,
  sectionsContentSchema,
]);
export type BriefContent = z.infer<typeof briefContentSchema>;

export function parseBriefContent(value: unknown): BriefContent | null {
  const parsed = briefContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Section keys, in display order, for the tumor board brief. */
export const TUMOR_BOARD_SECTIONS = [
  { key: "caseSummary", title: "Case summary" },
  { key: "diagnosis", title: "Diagnosis" },
  { key: "patientHistory", title: "Patient history" },
  { key: "imaging", title: "Imaging" },
  { key: "pathology", title: "Pathology" },
  { key: "labs", title: "Labs" },
  { key: "previousTreatment", title: "Previous treatment" },
  { key: "currentTreatment", title: "Current treatment" },
  { key: "missingInformation", title: "Missing information" },
  { key: "openQuestions", title: "Open questions" },
  { key: "decisionsRequired", title: "Decisions required" },
  { key: "questionsForTumorBoard", title: "Questions for tumor board" },
] as const;

/** Section keys, in display order, for the patient handoff. */
export const HANDOFF_SECTIONS = [
  { key: "currentCondition", title: "Current condition" },
  { key: "changesSincePrevious", title: "Changes since previous shift" },
  { key: "pending", title: "Pending" },
  { key: "risks", title: "Risks" },
  { key: "nextActions", title: "Next actions" },
] as const;
