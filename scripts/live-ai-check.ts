/**
 * Live check of the AI layer against a real provider, on the synthetic demo cases.
 *
 *   npm run ai:live-check -- --max-usd 3                # Carter and Kim (default)
 *   npm run ai:live-check -- --max-usd 8 --cases all    # every demo case
 *   npm run ai:live-check -- --dry-run                  # no API calls: prompt sizes and a cost estimate
 *
 * It runs the same provider code the app uses (LLMCaseAIProvider) for every AI
 * feature: case summary, tumor board brief, handoff, missing information, two
 * discussion questions (one the record can answer, one it cannot), follow-up
 * tasks for the case's first decision, and the two calls of document
 * processing (timeline and memory facts) for the newest document. It records
 * errors, latency, tokens and cost per call, and checks citations.
 *
 * Spending: every call first reserves the most it can cost (scripts/ai-check/meter.ts)
 * and runs only if that fits in --max-usd; billed failures are counted too.
 * Also set a spending limit in the provider console. The SDK does not retry,
 * so each metered call is one request.
 *
 * It only reads the database (E2E_DATABASE_URL by default, which holds the
 * seeded synthetic demo; --database dev uses DATABASE_URL). The report goes to
 * test-results/ai-live-check/ (git-ignored).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config as loadEnv } from "dotenv";
import { AnthropicLLMClient, LLMCaseAIProvider, OpenAILLMClient, resolveAIConfig, type CaseAnswer, type LLMClient } from "@ccr/ai";
import { loadCaseContext, prisma } from "@ccr/database";
import type { CaseContext, ContextDocument, SectionsContent, SourceRef } from "@ccr/types";
import { BudgetExceeded, describe, DryRunStop, MeteredClient, type CallRecord } from "./ai-check/meter";

const ROOT = path.resolve(import.meta.dirname, "..");
loadEnv({ path: path.join(ROOT, ".env"), quiet: true });

// ---- Arguments -----------------------------------------------------------------

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const dryRun = process.argv.includes("--dry-run");
const maxUsd = Number(argument("max-usd") ?? Number.NaN);
const caseNames = (argument("cases") ?? "Carter,Kim").split(",").map((name) => name.trim());
const databaseUrl = argument("database") === "dev" ? process.env.DATABASE_URL : process.env.E2E_DATABASE_URL;

if (!databaseUrl) throw new Error("Set E2E_DATABASE_URL (seeded by `npm run test:e2e` or the seed script), or pass --database dev.");
process.env.DATABASE_URL = databaseUrl; // the Prisma client is created on first use
if (!dryRun && !(Number.isFinite(maxUsd) && maxUsd > 0)) {
  throw new Error("Pass --max-usd <positive amount>: this check calls a paid API. Use --dry-run for a free estimate.");
}

// ---- Checks on the outputs ---------------------------------------------------------

const verifiedCount = (sources: SourceRef[]) => sources.filter((source) => source.verified).length;
const sectionChecks = (content: SectionsContent) => ({
  sections: content.sections.length,
  sectionsWithSources: content.sections.filter((section) => section.sources.length > 0).length,
  emptySections: content.sections.filter((section) => !section.body.trim()).length,
  verifiedExcerpts: content.sections.reduce((sum, section) => sum + verifiedCount(section.sources), 0),
});

const UNANSWERABLE = "What did the liver transplant evaluation conclude, and when was it done?";
const ANSWERABLE = "What did the most recent pathology or imaging report show? Quote the key finding.";

interface CaseReport {
  case: string;
  documents: number;
  outputs: Record<string, unknown>;
  checks: Record<string, unknown>;
  errors: string[];
  stoppedByBudget?: string;
}

/** Run every AI step for one case. A budget stop ends the case early but keeps what it already collected. */
async function runCase(provider: LLMCaseAIProvider, meter: MeteredClient, lastName: string): Promise<CaseReport> {
  const room = await prisma.caseRoom.findFirst({ where: { patient: { lastName } }, select: { id: true, createdById: true } });
  if (!room) throw new Error(`No demo case for patient ${lastName}: is the database seeded?`);
  const ctx: CaseContext = await loadCaseContext(prisma, room.id, { requesterId: room.createdById, messageLimit: 40 });
  const report: CaseReport = { case: lastName, documents: ctx.documents.length, outputs: {}, checks: {}, errors: [] };
  const newest: ContextDocument | undefined = [...ctx.documents].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const decision = ctx.decisions[0];

  const step = async <T>(name: string, run: () => Promise<{ output: T }>, check: (output: T) => Record<string, unknown>) => {
    meter.current = { case: lastName, step: name };
    try {
      const { output } = await run();
      report.outputs[name] = output;
      report.checks[name] = check(output);
    } catch (error) {
      if (error instanceof DryRunStop) return;
      if (error instanceof BudgetExceeded) throw error;
      report.errors.push(`${name}: ${describe(error)}`);
    }
  };
  const answerChecks = (expectAnswer: boolean) => (answer: CaseAnswer) => ({
    confidence: answer.confidence,
    sources: answer.sources.length,
    verifiedExcerpts: verifiedCount(answer.sources),
    droppedCitations: answer.droppedCitations,
    // The record cannot answer the second question: a confident, sourced answer would be a red flag.
    expectationMet: expectAnswer ? answer.sources.length > 0 : answer.confidence === "insufficient" || answer.confidence === "low",
  });

  try {
    await step("case_summary", () => provider.generateCaseSummary(ctx), (summary) => ({
      keyFindings: summary.keyFindings.length,
      keyFindingsWithSources: summary.keyFindings.filter((finding) => finding.sources.length > 0).length,
      latestResults: summary.latestResults.length,
      latestResultsWithSources: summary.latestResults.filter((result) => result.sources.length > 0).length,
      verifiedExcerpts: [...summary.keyFindings, ...summary.latestResults].reduce((sum, item) => sum + verifiedCount(item.sources), 0),
    }));
    await step("tumor_board_brief", () => provider.generateTumorBoardBrief(ctx), sectionChecks);
    await step("handoff", () => provider.generateHandoff(ctx), sectionChecks);
    await step("missing_information", () => provider.identifyMissingInformation(ctx), (items) => ({ items: items.length }));
    await step("question_answerable", () => provider.answerCaseQuestion(ctx, { text: ANSWERABLE, requester: ctx.requester }), answerChecks(true));
    await step("question_not_in_record", () => provider.answerCaseQuestion(ctx, { text: UNANSWERABLE, requester: ctx.requester }), answerChecks(false));
    if (decision) {
      await step("follow_up_tasks", () => provider.suggestFollowUpTasks(ctx, decision.id), (tasks) => ({
        decision: `#${decision.number}`,
        tasks: tasks.length,
        // Medication orders must never be suggested (instruction to the model; checked here).
        mentionsDosing: tasks.filter((task) => /\b\d+(\.\d+)?\s?(mg|mcg|g|units?|ml)\b/i.test(`${task.title} ${task.description}`)).length,
      }));
    }
    if (newest) {
      await step("document_timeline", () => provider.generateTimeline(ctx, [newest]), (events) => ({
        document: newest.title,
        events: events.length,
        eventsFromThisDocument: events.filter((event) => event.sourceDocumentId === newest.id).length,
        withDates: events.filter((event) => /^\d{4}-\d{2}-\d{2}$/.test(event.date)).length,
      }));
      await step("document_memory_facts", () => provider.extractMemoryFacts(ctx, newest), (facts) =>
        Object.fromEntries(Object.entries(facts).map(([key, value]) => [key, Array.isArray(value) ? value.length : value])),
      );
    }
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    report.stoppedByBudget = error.message;
  }
  return report;
}

// ---- Main ---------------------------------------------------------------------------

async function main() {
  const config = resolveAIConfig(process.env);
  const providerId = config.provider === "openai" ? "openai" : "anthropic";
  const model = providerId === "openai" ? config.openai.model : config.anthropic.model;
  let inner: LLMClient | null = null;
  if (!dryRun) {
    const apiKey = providerId === "openai" ? config.openai.apiKey : config.anthropic.apiKey;
    if (config.provider === "demo" || !apiKey) throw new Error("No provider key: set ANTHROPIC_API_KEY (or OPENAI_API_KEY) in .env.");
    inner =
      providerId === "anthropic"
        ? new AnthropicLLMClient({ client: new Anthropic({ apiKey, maxRetries: 0 }), model, effort: config.anthropic.effort })
        : new OpenAILLMClient({ apiKey, model });
  }
  // Refuses unpriced models and invalid budgets before anything is sent.
  const meter = new MeteredClient(inner, { providerId, model, maxUsd: dryRun ? Number.POSITIVE_INFINITY : maxUsd });
  const provider = new LLMCaseAIProvider(meter);

  const names =
    caseNames[0] === "all"
      ? (await prisma.patient.findMany({ select: { lastName: true }, orderBy: { lastName: "asc" } })).map((patient) => patient.lastName)
      : caseNames;

  console.log(`${dryRun ? "DRY RUN (no API calls)" : `LIVE: ${providerId} ${model}, budget $${maxUsd}`} on ${names.join(", ")}`);
  const reports: CaseReport[] = [];
  for (const name of names) {
    const report = await runCase(provider, meter, name);
    reports.push(report);
    if (report.stoppedByBudget) break;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join(ROOT, "test-results", "ai-live-check", `${dryRun ? "dry-run" : "live"}-${stamp}`);
  await mkdir(directory, { recursive: true });
  const totals = {
    calls: meter.calls.length,
    failedCalls: meter.calls.filter((call) => !call.ok).length,
    usd: Number(meter.spentUsd.toFixed(4)),
    kind: dryRun ? "conservative estimate (all input at the cache-write rate, full output caps)" : "metered (billed usage; reservations where usage is unknown)",
    stoppedByBudget: reports.find((report) => report.stoppedByBudget)?.stoppedByBudget ?? null,
    halted: meter.halted,
  };
  await writeFile(path.join(directory, "report.json"), JSON.stringify({ provider: providerId, model, totals, calls: meter.calls, reports }, null, 2));
  await writeFile(path.join(directory, "report.md"), markdownReport(providerId, model, totals, meter.calls, reports));

  console.table(
    meter.calls.map(({ case: c, step, ok, latencyMs, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, usd, basis }) => ({
      case: c, step, ok, ms: latencyMs, in: inputTokens, out: outputTokens, cacheRead: cacheReadTokens, cacheWrite: cacheWriteTokens, usd: usd.toFixed(4), basis,
    })),
  );
  console.log(JSON.stringify(totals));
  for (const report of reports) {
    console.log(report.case, JSON.stringify(report.checks));
    for (const error of report.errors) console.log(`  ERROR ${error}`);
    if (report.stoppedByBudget) console.log(`  STOPPED ${report.stoppedByBudget}`);
  }
  console.log(`Report: ${path.relative(ROOT, directory)}/report.md`);
}

function markdownReport(providerId: string, model: string, totals: Record<string, unknown>, calls: CallRecord[], reports: CaseReport[]): string {
  const lines = [
    `# AI live check (${providerId} ${model})`,
    "",
    "Synthetic demo data only.",
    "",
    "```json",
    JSON.stringify(totals, null, 2),
    "```",
    "",
    "| Case | Step | OK | ms | Input | Output | Cache read | Cache write | USD | Basis |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...calls.map(
      (call) =>
        `| ${call.case} | ${call.step} | ${call.ok ? "yes" : `no: ${call.error}`} | ${call.latencyMs} | ${call.inputTokens ?? ""} | ${call.outputTokens ?? ""} | ${call.cacheReadTokens ?? ""} | ${call.cacheWriteTokens ?? ""} | ${call.usd.toFixed(4)} | ${call.basis} |`,
    ),
  ];
  for (const report of reports) {
    lines.push("", `## ${report.case} (${report.documents} documents)`, "", "### Checks", "", "```json", JSON.stringify(report.checks, null, 2), "```");
    if (report.errors.length) lines.push("", "### Errors", "", ...report.errors.map((error) => `- ${error}`));
    if (report.stoppedByBudget) lines.push("", `**Stopped:** ${report.stoppedByBudget}`);
    lines.push("", "### Outputs (for human review)", "", "```json", JSON.stringify(report.outputs, null, 2), "```");
  }
  return `${lines.join("\n")}\n`;
}

main()
  .catch((error) => {
    console.error(describe(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
