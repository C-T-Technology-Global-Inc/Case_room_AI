/**
 * @ccr/ai: provider-agnostic clinical AI layer.
 *
 *   providers/  low-level LLM clients (Anthropic, OpenAI) behind LLMClient
 *   context/    case record serialization + citation registry (source grounding)
 *   retrieval/  lexical passage retrieval (BM25)
 *   prompts/    system + task prompts
 *   memory/     shared patient memory merge logic
 *   services/   CaseAIProvider interface, LLM-backed and offline demo implementations
 */

export { resolveAIConfig, type AIConfig } from "./config";
export { AIError, AIConfigurationError, AIOutputError, AIProviderError, AIRefusalError, toUserMessage } from "./errors";

export type { LLMClient, StructuredRequest, StructuredResponse, PromptBlock, ReasoningEffort } from "./providers/llm-client";
export { AnthropicLLMClient, DEFAULT_ANTHROPIC_MODEL } from "./providers/anthropic";
export { OpenAILLMClient, DEFAULT_OPENAI_MODEL } from "./providers/openai";

export { SourceRegistry, verifyQuote, normalizeForMatch } from "./context/source-registry";
export { numberInlineCitations } from "./context/citations";
export { formatCaseRecord, FULL_CONTEXT_CHAR_BUDGET, safe as neutralizeWrapperTags } from "./context/format-context";

export { BM25Index } from "./retrieval/bm25";
export { chunkDocument, retrievePassages } from "./retrieval/passages";

export { mergeMemoryFacts, removeDocumentFromMemory, emptyMemoryFacts, type MemoryFacts } from "./memory/merge";

export type {
  AIProviderId,
  AIProviderInfo,
  AIRunResult,
  CaseAIProvider,
  CaseAnswer,
  CaseQuestion,
  CaseSummaryDraft,
  ExtractedTimelineEvent,
  MissingInformationItem,
  SuggestedTask,
} from "./services/types";
export { LLMCaseAIProvider } from "./services/llm-provider";
export { DemoCaseAIProvider } from "./services/demo";
export { createCaseAIProvider } from "./services/factory";
