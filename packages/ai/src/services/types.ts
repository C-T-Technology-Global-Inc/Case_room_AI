import type {
  AIConfidence,
  CaseContext,
  CaseSummaryContent,
  ContextDocument,
  ContextRequester,
  SectionsContent,
  SourceRef,
  TaskPriority,
  TimelineEventType,
} from "@ccr/types";
import type { MemoryFacts } from "../memory/merge";

/**
 * The clinical AI capabilities the application depends on. The application
 * talks only to this interface; implementations exist for LLM providers
 * (Anthropic, OpenAI via LLMClient) and for an offline deterministic demo
 * engine. Future implementations (role-specific agents, guideline retrieval,
 * private models) plug in here.
 *
 * Nothing returned from these methods is ever treated as a final clinical
 * decision; callers store outputs as drafts that humans review.
 */
export interface CaseAIProvider {
  readonly info: AIProviderInfo;

  generateCaseSummary(ctx: CaseContext): Promise<AIRunResult<CaseSummaryDraft>>;
  /**
   * The complete set of timeline events found in `documents`. Callers replace
   * earlier AI events derived from those documents with this output.
   */
  generateTimeline(ctx: CaseContext, documents: ContextDocument[]): Promise<AIRunResult<ExtractedTimelineEvent[]>>;
  answerCaseQuestion(ctx: CaseContext, question: CaseQuestion): Promise<AIRunResult<CaseAnswer>>;
  identifyMissingInformation(ctx: CaseContext): Promise<AIRunResult<MissingInformationItem[]>>;
  generateHandoff(ctx: CaseContext): Promise<AIRunResult<SectionsContent>>;
  generateTumorBoardBrief(ctx: CaseContext): Promise<AIRunResult<SectionsContent>>;
  extractMemoryFacts(ctx: CaseContext, document: ContextDocument): Promise<AIRunResult<MemoryFacts>>;
  suggestFollowUpTasks(ctx: CaseContext, decisionId: string): Promise<AIRunResult<SuggestedTask[]>>;
}

export type AIProviderId = "anthropic" | "openai" | "demo";

export interface AIProviderInfo {
  id: AIProviderId;
  label: string;
  model: string;
  isDemo: boolean;
}

export interface AIRunResult<T> {
  output: T;
  provider: AIProviderInfo;
  /** Model that actually produced the output. */
  model: string;
  generatedAt: string;
  latencyMs: number;
}

export interface CaseQuestion {
  text: string;
  requester: ContextRequester | null;
}

export interface CaseAnswer {
  /** Answer text; inline citation markers look like [1], [2] and index into `sources`. */
  answer: string;
  sources: SourceRef[];
  confidence: AIConfidence;
  limitations: string;
  droppedCitations: number;
}

export type CaseSummaryDraft = Omit<CaseSummaryContent, "kind" | "missingInformation">;

export interface MissingInformationItem {
  item: string;
  reason: string;
  priority: "high" | "medium" | "low";
}

export interface ExtractedTimelineEvent {
  date: string;
  eventType: TimelineEventType;
  title: string;
  description: string;
  sourceDocumentId: string;
}

export interface SuggestedTask {
  title: string;
  description: string;
  priority: TaskPriority;
  assigneeId: string | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
}

export async function timed<T>(
  info: AIProviderInfo,
  fn: () => Promise<{ output: T; model?: string }>,
): Promise<AIRunResult<T>> {
  const started = Date.now();
  const { output, model } = await fn();
  return {
    output,
    provider: info,
    model: model ?? info.model,
    generatedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
  };
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
