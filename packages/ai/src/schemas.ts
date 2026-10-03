import { z } from "zod";
import { AI_CONFIDENCE_LEVELS, LAB_FLAGS, RESULT_FLAGS, TASK_PRIORITIES, TIMELINE_EVENT_TYPES, TREATMENT_STATUSES } from "@ccr/types";

/**
 * Structured-output schemas the LLM must satisfy. They reference records by
 * citation key (D1, T2, ...); keys are resolved to real records afterwards.
 *
 * Constraints: every field is required (use nullable instead of optional) and
 * no numeric/string length constraints, so the same schema works with
 * Anthropic structured outputs and OpenAI strict mode.
 */

const sourceKeys = z.array(z.string()).describe("Citation keys of supporting records, e.g. [\"D2\", \"T5\"]");

export const llmCaseAnswerSchema = z.object({
  answer: z.string().describe("Direct answer for the care team: 1-6 short sentences or '- ' bullet lines. Plain text."),
  citations: z
    .array(
      z.object({
        sourceKey: z.string().describe("Citation key of a record that supports the answer"),
        quote: z
          .string()
          .describe("Short verbatim excerpt (max ~30 words) copied exactly from that record; empty string if none"),
      }),
    )
    .describe("Every record the answer relies on"),
  confidence: z
    .enum(AI_CONFIDENCE_LEVELS)
    .describe(
      "high: directly and consistently documented; moderate: documented but incomplete or needs light synthesis; low: indirect or partial; insufficient: the record does not answer the question",
    ),
  limitations: z.string().describe("One sentence on what the answer does not cover or what a clinician should verify"),
});
export type LLMCaseAnswer = z.infer<typeof llmCaseAnswerSchema>;

export const llmCaseSummarySchema = z.object({
  headline: z.string().describe("One sentence: age, sex, diagnosis. E.g. '56-year-old male with pancreatic adenocarcinoma.'"),
  currentStatus: z.string().describe("1-2 sentences on where the case stands now"),
  currentDiagnosis: z.string().describe("Current working/confirmed diagnosis with stage or extent if documented"),
  currentTreatment: z.string().describe("Current or planned treatment as documented, or 'No active treatment documented.'"),
  keyFindings: z
    .array(z.object({ text: z.string(), sourceKeys }))
    .describe("3-7 most important documented findings"),
  latestResults: z
    .array(
      z.object({
        label: z.string().describe("Test or study name"),
        value: z.string().describe("Result exactly as documented, with units"),
        date: z.string().nullable().describe("YYYY-MM-DD or null"),
        flag: z.enum(RESULT_FLAGS),
        sourceKeys,
      }),
    )
    .describe("Most recent important results (labs, imaging, pathology), up to 8"),
  outstandingQuestions: z.array(z.string()).describe("Open clinical questions the team still needs to resolve"),
  limitations: z.string().describe("One sentence on gaps or caveats of this summary"),
});
export type LLMCaseSummary = z.infer<typeof llmCaseSummarySchema>;

export const llmMissingInformationSchema = z.object({
  items: z.array(
    z.object({
      item: z.string().describe("What is missing, e.g. 'Molecular (NGS) testing results'"),
      reason: z.string().describe("Why the team typically needs it for this case"),
      priority: z.enum(["high", "medium", "low"]),
    }),
  ),
});
export type LLMMissingInformation = z.infer<typeof llmMissingInformationSchema>;

export const llmTimelineSchema = z.object({
  events: z.array(
    z.object({
      date: z.string().describe("YYYY-MM-DD"),
      eventType: z.enum(TIMELINE_EVENT_TYPES),
      title: z.string().describe("Short event title, max ~8 words"),
      description: z.string().describe("1-2 sentences with the key clinical content, values as documented"),
      sourceKey: z.string().describe("Citation key of the document the event comes from"),
    }),
  ),
});
export type LLMTimeline = z.infer<typeof llmTimelineSchema>;

export const llmMemoryFactsSchema = z.object({
  diagnoses: z.array(z.object({ name: z.string(), detail: z.string() })),
  medications: z.array(z.object({ name: z.string(), detail: z.string() })),
  labs: z.array(z.object({ name: z.string(), value: z.string(), flag: z.enum(LAB_FLAGS) })),
  imaging: z.array(z.object({ study: z.string(), finding: z.string() })),
  pathology: z.array(z.object({ finding: z.string() })),
  treatments: z.array(z.object({ name: z.string(), status: z.enum(TREATMENT_STATUSES), detail: z.string() })),
  problems: z.array(z.string()),
  openQuestions: z.array(z.string()),
});
export type LLMMemoryFacts = z.infer<typeof llmMemoryFactsSchema>;

const section = z.object({
  text: z
    .string()
    .describe("Plain text. Use '- ' at the start of a line for bullets and '1. ' for numbered items. No markdown headings."),
  sourceKeys,
});

export const llmTumorBoardSchema = z.object({
  caseSummary: section,
  diagnosis: section,
  patientHistory: section,
  imaging: section,
  pathology: section,
  labs: section,
  previousTreatment: section,
  currentTreatment: section,
  missingInformation: section,
  openQuestions: section,
  decisionsRequired: section,
  questionsForTumorBoard: section,
  limitations: z.string(),
});
export type LLMTumorBoard = z.infer<typeof llmTumorBoardSchema>;

export const llmHandoffSchema = z.object({
  currentCondition: section,
  changesSincePrevious: section,
  pending: section,
  risks: section,
  nextActions: section,
  limitations: z.string(),
});
export type LLMHandoff = z.infer<typeof llmHandoffSchema>;

export const llmFollowUpTasksSchema = z.object({
  tasks: z.array(
    z.object({
      title: z.string().describe("Actionable task title, imperative voice"),
      description: z.string(),
      priority: z.enum(TASK_PRIORITIES),
      assigneeKey: z.string().nullable().describe("Team member key (U#) best placed to own the task, or null"),
      dueInDays: z.number().int().describe("Suggested due date as days from today (0-60)"),
    }),
  ),
});
export type LLMFollowUpTasks = z.infer<typeof llmFollowUpTasksSchema>;
