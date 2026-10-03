import "server-only";
import { createCaseAIProvider, resolveAIConfig, type AIProviderInfo, type CaseAIProvider } from "@ccr/ai";
import { loadCaseContext, prisma } from "@ccr/database";
import type { CaseContext } from "@ccr/types";

/**
 * Glue between the application and the provider-agnostic AI layer.
 * The provider is chosen from environment configuration (see .env.example).
 */

const globalForAI = globalThis as unknown as { __ccrAIProvider?: CaseAIProvider };

export function getAIProvider(): CaseAIProvider {
  globalForAI.__ccrAIProvider ??= createCaseAIProvider(resolveAIConfig());
  return globalForAI.__ccrAIProvider;
}

export function getAIProviderInfo(): AIProviderInfo {
  try {
    return getAIProvider().info;
  } catch {
    const config = resolveAIConfig();
    return { id: config.provider, label: `${config.provider} (misconfigured)`, model: "n/a", isDemo: false };
  }
}

/** Authorized case context for the AI; callers must already have checked access. */
export function buildCaseContext(caseRoomId: string, requesterId: string | null): Promise<CaseContext> {
  return loadCaseContext(prisma, caseRoomId, { requesterId, messageLimit: 40 });
}
