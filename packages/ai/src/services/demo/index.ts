import type { CaseContext, ContextDocument, SectionsContent } from "@ccr/types";
import { SourceRegistry } from "../../context/source-registry";
import type { MemoryFacts } from "../../memory/merge";
import {
  timed,
  type AIProviderInfo,
  type AIRunResult,
  type CaseAIProvider,
  type CaseAnswer,
  type CaseQuestion,
  type CaseSummaryDraft,
  type ExtractedTimelineEvent,
  type MissingInformationItem,
  type SuggestedTask,
} from "../types";
import { answerDemoQuestion } from "./answer";
import { buildCaseSummary, buildFollowUpTasks, buildHandoff, buildMissingInformation, buildTumorBoardBrief } from "./briefs";
import { memoryFactsForDocument, timelineEventsForDocument } from "./extract";

export interface DemoProviderOptions {
  /** Artificial latency so the UI's "AI is working" states are visible in demos. */
  simulatedLatencyMs?: number;
}

/**
 * Offline, deterministic implementation of CaseAIProvider. It lets the product
 * run end-to-end without an API key: every output is assembled from verbatim
 * record content with rule-based extraction, and every statement is sourced.
 * It is clearly labelled in the UI as a demo engine, not a language model.
 */
export class DemoCaseAIProvider implements CaseAIProvider {
  readonly info: AIProviderInfo = {
    id: "demo",
    label: "Demo AI (offline)",
    model: "rule-based-extractor-v1",
    isDemo: true,
  };

  constructor(private readonly options: DemoProviderOptions = {}) {}

  private async pause() {
    const ms = this.options.simulatedLatencyMs ?? 0;
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
  }

  generateCaseSummary(ctx: CaseContext): Promise<AIRunResult<CaseSummaryDraft>> {
    return timed(this.info, async () => {
      await this.pause();
      return { output: buildCaseSummary(ctx, new SourceRegistry(ctx)) };
    });
  }

  generateTimeline(_ctx: CaseContext, documents: ContextDocument[]): Promise<AIRunResult<ExtractedTimelineEvent[]>> {
    return timed(this.info, async () => {
      await this.pause();
      return { output: documents.flatMap((doc) => timelineEventsForDocument(doc)) };
    });
  }

  answerCaseQuestion(ctx: CaseContext, question: CaseQuestion): Promise<AIRunResult<CaseAnswer>> {
    return timed(this.info, async () => {
      await this.pause();
      return { output: answerDemoQuestion(ctx, new SourceRegistry(ctx), question.text) };
    });
  }

  identifyMissingInformation(ctx: CaseContext): Promise<AIRunResult<MissingInformationItem[]>> {
    return timed(this.info, async () => ({ output: buildMissingInformation(ctx) }));
  }

  generateHandoff(ctx: CaseContext): Promise<AIRunResult<SectionsContent>> {
    return timed(this.info, async () => {
      await this.pause();
      return { output: buildHandoff(ctx, new SourceRegistry(ctx)) };
    });
  }

  generateTumorBoardBrief(ctx: CaseContext): Promise<AIRunResult<SectionsContent>> {
    return timed(this.info, async () => {
      await this.pause();
      return { output: buildTumorBoardBrief(ctx, new SourceRegistry(ctx)) };
    });
  }

  extractMemoryFacts(_ctx: CaseContext, document: ContextDocument): Promise<AIRunResult<MemoryFacts>> {
    return timed(this.info, async () => ({ output: memoryFactsForDocument(document) }));
  }

  suggestFollowUpTasks(ctx: CaseContext, decisionId: string): Promise<AIRunResult<SuggestedTask[]>> {
    return timed(this.info, async () => {
      await this.pause();
      return { output: buildFollowUpTasks(ctx, decisionId) };
    });
  }
}
