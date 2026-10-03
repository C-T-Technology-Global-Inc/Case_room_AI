import type { BriefSection, CaseContext, ContextDocument, SectionsContent } from "@ccr/types";
import { HANDOFF_SECTIONS, TUMOR_BOARD_SECTIONS, USER_ROLE_LABELS } from "@ccr/types";
import { numberInlineCitations } from "../context/citations";
import { formatCaseRecord, quoted, type CaseRecordBlocks } from "../context/format-context";
import { SourceRegistry } from "../context/source-registry";
import { AIOutputError } from "../errors";
import type { MemoryFacts } from "../memory/merge";
import { CLINICAL_ASSISTANT_SYSTEM_PROMPT } from "../prompts/system";
import {
  caseQuestionPrompt,
  caseSummaryPrompt,
  followUpTasksPrompt,
  handoffPrompt,
  memoryFactsPrompt,
  missingInformationPrompt,
  timelinePrompt,
  tumorBoardPrompt,
} from "../prompts/tasks";
import type { LLMClient, PromptBlock } from "../providers/llm-client";
import {
  llmCaseAnswerSchema,
  llmCaseSummarySchema,
  llmFollowUpTasksSchema,
  llmHandoffSchema,
  llmMemoryFactsSchema,
  llmMissingInformationSchema,
  llmTimelineSchema,
  llmTumorBoardSchema,
} from "../schemas";
import {
  addDays,
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
} from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** CaseAIProvider backed by a real LLM (Anthropic, OpenAI, ...). */
export class LLMCaseAIProvider implements CaseAIProvider {
  readonly info: AIProviderInfo;

  constructor(private readonly llm: LLMClient) {
    this.info = {
      id: llm.providerId,
      label: llm.providerId === "anthropic" ? "Anthropic Claude" : "OpenAI",
      model: llm.model,
      isDemo: false,
    };
  }

  /**
   * Fixed rules go in the system prompt; the case record goes in the user turn
   * as data, documents first so they can be prompt-cached across questions.
   */
  private request(blocks: CaseRecordBlocks): { system: string; context: PromptBlock[] } {
    return {
      system: CLINICAL_ASSISTANT_SYSTEM_PROMPT,
      context: [
        { text: blocks.documents, cacheable: true },
        { text: blocks.state },
        ...(blocks.discussion ? [{ text: blocks.discussion }] : []),
      ],
    };
  }

  generateCaseSummary(ctx: CaseContext): Promise<AIRunResult<CaseSummaryDraft>> {
    return timed(this.info, async () => {
      const registry = new SourceRegistry(ctx);
      const blocks = formatCaseRecord(ctx, registry, { query: ctx.patient.primaryDiagnosis });
      const response = await this.llm.generateStructured({
        task: "case_summary",
        ...this.request(blocks),
        prompt: caseSummaryPrompt(ctx),
        schema: llmCaseSummarySchema,
        schemaName: "case_summary",
      });
      const data = response.data;
      const output: CaseSummaryDraft = {
        headline: data.headline,
        currentStatus: data.currentStatus,
        currentDiagnosis: data.currentDiagnosis,
        currentTreatment: data.currentTreatment,
        keyFindings: data.keyFindings.map((finding) => ({
          text: finding.text,
          sources: registry.resolveKeys(finding.sourceKeys).sources,
        })),
        latestResults: data.latestResults.map((result) => ({
          label: result.label,
          value: result.value,
          date: result.date && ISO_DATE.test(result.date) ? result.date : null,
          flag: result.flag,
          sources: registry.resolveKeys(result.sourceKeys).sources,
        })),
        outstandingQuestions: data.outstandingQuestions,
        limitations: data.limitations,
      };
      return { output, model: response.model };
    });
  }

  generateTimeline(ctx: CaseContext, documents: ContextDocument[]): Promise<AIRunResult<ExtractedTimelineEvent[]>> {
    return timed(this.info, async () => {
      if (documents.length === 0) return { output: [] };
      const docIds = new Set(documents.map((doc) => doc.id));
      // The output replaces earlier AI events derived from these documents, so the model must not
      // see them (it is told not to duplicate the TIMELINE and could otherwise return nothing).
      const timelineCtx: CaseContext = {
        ...ctx,
        timeline: ctx.timeline.filter((event) => !(event.createdByAI && (event.sourceDocumentId === null || docIds.has(event.sourceDocumentId)))),
      };
      const registry = new SourceRegistry(timelineCtx);
      const keys = new Map(documents.map((doc) => [doc.id, registry.keyFor(doc.id) ?? "?"]));
      const blocks = formatCaseRecord(timelineCtx, registry, {
        onlyDocumentIds: documents.map((doc) => doc.id),
        includeDiscussion: false,
      });
      const response = await this.llm.generateStructured({
        task: "timeline",
        ...this.request(blocks),
        prompt: timelinePrompt(documents, keys),
        schema: llmTimelineSchema,
        schemaName: "timeline_events",
        effort: "low",
      });

      const events: ExtractedTimelineEvent[] = [];
      for (const event of response.data.events) {
        const entry = registry.get(event.sourceKey);
        // An event must cite one of the processed documents. Events with any
        // other key are dropped: a default source is never substituted, even
        // when only one document is being processed.
        if (!entry || entry.kind !== "document" || !docIds.has(entry.id)) continue;
        const sourceDoc = documents.find((doc) => doc.id === entry.id)!;
        events.push({
          date: ISO_DATE.test(event.date) ? event.date : sourceDoc.date,
          eventType: event.eventType,
          title: event.title.trim(),
          description: event.description.trim(),
          sourceDocumentId: sourceDoc.id,
        });
      }
      return { output: events, model: response.model };
    });
  }

  answerCaseQuestion(ctx: CaseContext, question: CaseQuestion): Promise<AIRunResult<CaseAnswer>> {
    return timed(this.info, async () => {
      const registry = new SourceRegistry(ctx);
      const blocks = formatCaseRecord(ctx, registry, { query: question.text });
      const response = await this.llm.generateStructured({
        task: "case_question",
        ...this.request(blocks),
        prompt: caseQuestionPrompt({
          question: question.text,
          requester: question.requester,
        }),
        schema: llmCaseAnswerSchema,
        schemaName: "case_answer",
      });
      const data = response.data;
      const resolved = registry.resolve(data.citations);
      const inline = numberInlineCitations(data.answer, registry, resolved.sources);
      const dropped = resolved.dropped + inline.dropped;

      let confidence = data.confidence;
      const limitations = [data.limitations.trim()];
      if (inline.sources.length === 0 && confidence !== "insufficient") {
        confidence = "low";
        limitations.push("No verifiable source in the case record was cited for this answer.");
      }
      if (dropped > 0) {
        limitations.push(`${dropped} citation${dropped === 1 ? "" : "s"} that did not match a case record ${dropped === 1 ? "was" : "were"} removed.`);
      }

      return {
        output: {
          answer: inline.text,
          sources: inline.sources,
          confidence,
          limitations: limitations.filter(Boolean).join(" "),
          droppedCitations: dropped,
        },
        model: response.model,
      };
    });
  }

  identifyMissingInformation(ctx: CaseContext): Promise<AIRunResult<MissingInformationItem[]>> {
    return timed(this.info, async () => {
      const registry = new SourceRegistry(ctx);
      const blocks = formatCaseRecord(ctx, registry, { query: ctx.patient.primaryDiagnosis, includeDiscussion: false });
      const response = await this.llm.generateStructured({
        task: "missing_information",
        ...this.request(blocks),
        prompt: missingInformationPrompt(ctx),
        schema: llmMissingInformationSchema,
        schemaName: "missing_information",
        effort: "low",
      });
      return { output: response.data.items.slice(0, 8), model: response.model };
    });
  }

  generateHandoff(ctx: CaseContext): Promise<AIRunResult<SectionsContent>> {
    return timed(this.info, async () => {
      const registry = new SourceRegistry(ctx);
      const blocks = formatCaseRecord(ctx, registry, { query: "current condition changes pending risks plan" });
      const response = await this.llm.generateStructured({
        task: "handoff",
        ...this.request(blocks),
        prompt: handoffPrompt(ctx),
        schema: llmHandoffSchema,
        schemaName: "patient_handoff",
      });
      const data = response.data;
      const sections: BriefSection[] = HANDOFF_SECTIONS.map(({ key, title }) =>
        toSection(key, title, data[key], registry),
      );
      return { output: { kind: "sections", sections, limitations: data.limitations }, model: response.model };
    });
  }

  generateTumorBoardBrief(ctx: CaseContext): Promise<AIRunResult<SectionsContent>> {
    return timed(this.info, async () => {
      const registry = new SourceRegistry(ctx);
      const blocks = formatCaseRecord(ctx, registry, { query: ctx.patient.primaryDiagnosis });
      const response = await this.llm.generateStructured({
        task: "tumor_board_brief",
        ...this.request(blocks),
        prompt: tumorBoardPrompt(),
        schema: llmTumorBoardSchema,
        schemaName: "tumor_board_brief",
        effort: "high",
        maxOutputTokens: 24000,
      });
      const data = response.data;
      const sections: BriefSection[] = TUMOR_BOARD_SECTIONS.map(({ key, title }) =>
        toSection(key, title, data[key], registry),
      );
      return { output: { kind: "sections", sections, limitations: data.limitations }, model: response.model };
    });
  }

  extractMemoryFacts(ctx: CaseContext, document: ContextDocument): Promise<AIRunResult<MemoryFacts>> {
    return timed(this.info, async () => {
      const registry = new SourceRegistry(ctx);
      const key = registry.keyFor(document.id);
      if (!key) throw new AIOutputError(`Document ${document.id} is not part of the case context`);
      const blocks = formatCaseRecord(ctx, registry, { onlyDocumentIds: [document.id], includeDiscussion: false });
      const response = await this.llm.generateStructured({
        task: "memory_facts",
        ...this.request(blocks),
        prompt: memoryFactsPrompt(document, key),
        schema: llmMemoryFactsSchema,
        schemaName: "memory_facts",
        effort: "low",
      });
      return { output: response.data, model: response.model };
    });
  }

  suggestFollowUpTasks(ctx: CaseContext, decisionId: string): Promise<AIRunResult<SuggestedTask[]>> {
    return timed(this.info, async () => {
      const decision = ctx.decisions.find((d) => d.id === decisionId);
      if (!decision) throw new AIOutputError(`Decision ${decisionId} is not part of the case context`);
      const registry = new SourceRegistry(ctx);
      const blocks = formatCaseRecord(ctx, registry, { query: `${decision.title} ${decision.description}` });
      const teamKeys = new Map(ctx.team.map((member, index) => [`U${index + 1}`, member.id]));
      const teamList = ctx.team
        .map((member, index) => `U${index + 1}: ${quoted(member.name)} (${quoted(member.specialty ?? USER_ROLE_LABELS[member.role])})`)
        .join("\n");
      const response = await this.llm.generateStructured({
        task: "follow_up_tasks",
        ...this.request(blocks),
        prompt: followUpTasksPrompt({ decisionKey: `DEC${decision.number}`, teamList }),
        schema: llmFollowUpTasksSchema,
        schemaName: "follow_up_tasks",
        effort: "low",
      });
      const today = ctx.now.slice(0, 10);
      const tasks = response.data.tasks.slice(0, 6).map((task) => ({
        title: task.title.trim(),
        description: task.description.trim(),
        priority: task.priority,
        assigneeId: task.assigneeKey ? teamKeys.get(task.assigneeKey.trim().toUpperCase()) ?? null : null,
        dueDate: addDays(today, Math.min(60, Math.max(0, Math.round(task.dueInDays)))),
      }));
      return { output: tasks, model: response.model };
    });
  }
}

function toSection(
  key: string,
  title: string,
  section: { text: string; sourceKeys: string[] },
  registry: SourceRegistry,
): BriefSection {
  const resolved = registry.resolveKeys(section.sourceKeys);
  const inline = numberInlineCitations(section.text, registry, resolved.sources);
  return { key, title, body: inline.text, sources: inline.sources };
}
