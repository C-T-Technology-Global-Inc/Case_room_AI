import { z } from "zod";
import { DOCUMENT_TYPES } from "./enums";

/**
 * A reference from AI output back to a real record in the case.
 * Sources are always resolved server-side against records that exist in the
 * case context; the model can only cite keys it was given, never invent them.
 */
export const SOURCE_KINDS = ["document", "timeline", "decision", "task", "message"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const sourceRefSchema = z.object({
  kind: z.enum(SOURCE_KINDS),
  /** Database id of the referenced record. */
  id: z.string(),
  /** Human readable label, e.g. "CT Abdomen/Pelvis". */
  label: z.string(),
  /** ISO date (YYYY-MM-DD) of the record when known. */
  date: z.string().nullable(),
  documentType: z.enum(DOCUMENT_TYPES).nullable().optional(),
  /** Verbatim excerpt from the source that supports the statement. */
  excerpt: z.string().nullable().optional(),
  /** True when the excerpt was verified to appear verbatim in the source text. */
  verified: z.boolean().optional(),
});
export type SourceRef = z.infer<typeof sourceRefSchema>;
