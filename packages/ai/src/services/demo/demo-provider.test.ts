import { describe, expect, it } from "vitest";
import { mergeMemoryFacts } from "../../memory/merge";
import { syntheticCase } from "../../test/fixtures";
import { parseLabs, parseSections } from "./clinical-text";
import { DemoCaseAIProvider } from "./index";

const ai = new DemoCaseAIProvider();

describe("clinical text parsing", () => {
  it("parses uppercase section headings", () => {
    const headings = parseSections(syntheticCase().documents[3]!.text).map((s) => s.heading);
    expect(headings).toEqual(expect.arrayContaining(["SITUATION", "ASSESSMENT", "PENDING", "RISKS", "RECOMMENDATIONS FOR NEXT SHIFT"]));
  });

  it("reads lab flags from the last column without eating units", () => {
    const labs = parseLabs(syntheticCase().documents[1]!.text);
    const fev1 = labs.find((l) => l.name === "FEV1");
    expect(fev1).toMatchObject({ value: "1.98", unit: "L", flag: "low" });
    expect(labs.find((l) => l.name === "CA 19-9")).toMatchObject({ flag: "high", unit: "U/mL" });
    expect(labs.find((l) => l.name === "Platelets")?.flag).toBe("normal");
  });
});

describe("DemoCaseAIProvider", () => {
  it("answers from the record with verified sources", async () => {
    const { output } = await ai.answerCaseQuestion(syntheticCase(), { text: "summarize the pathology findings", requester: null });
    expect(output.confidence).toBe("high");
    expect(output.answer).toContain("Invasive adenocarcinoma");
    expect(output.sources[0]).toMatchObject({ id: "doc-path", verified: true });
  });

  it("reports lab trends across reports and notes", async () => {
    const { output } = await ai.answerCaseQuestion(syntheticCase(), { text: "what is the latest hemoglobin?", requester: null });
    expect(output.answer).toMatch(/Latest Hemoglobin: 10\.1 g\/dL/);
    expect(output.answer).toMatch(/12\.9 .* → 10\.1/);
  });

  it("says so when the record cannot answer", async () => {
    const { output } = await ai.answerCaseQuestion(syntheticCase(), { text: "What did the liver transplant evaluation conclude?", requester: null });
    expect(output.confidence).toBe("insufficient");
    expect(output.sources).toHaveLength(0);
  });

  it("finds answers in the team discussion", async () => {
    const { output } = await ai.answerCaseQuestion(syntheticCase(), { text: "When is tumor board?", requester: null });
    expect(output.answer).toContain("Oct 2 at 07:30");
    expect(output.sources.some((s) => s.kind === "message")).toBe(true);
  });

  it("extracts one sourced timeline event per document", async () => {
    const ctx = syntheticCase();
    const { output } = await ai.generateTimeline(ctx, ctx.documents);
    expect(output).toHaveLength(4);
    expect(output.find((e) => e.sourceDocumentId === "doc-path")?.title).toBe("Pathology confirms invasive adenocarcinoma");
    expect(output.find((e) => e.sourceDocumentId === "doc-labs")?.title).toBe("CA 19-9 elevated");
  });

  it("flags missing molecular results for oncology cases", async () => {
    const { output } = await ai.identifyMissingInformation(syntheticCase());
    expect(output.map((m) => m.item)).toContain("Molecular / biomarker testing results");
  });

  it("builds a handoff from the latest nursing note", async () => {
    const { output } = await ai.generateHandoff(syntheticCase());
    const risks = output.sections.find((s) => s.key === "risks");
    expect(risks?.body).toContain("Bleeding: falling hemoglobin.");
    expect(risks?.sources[0]?.id).toBe("doc-nursing");
  });

  it("never proposes approvals: follow-up tasks are suggestions only", async () => {
    const ctx = syntheticCase();
    const { output } = await ai.suggestFollowUpTasks(ctx, "dec1");
    expect(output.length).toBeGreaterThan(0);
    for (const task of output) expect(task).not.toHaveProperty("approved");
  });
});

describe("shared memory merge", () => {
  it("is idempotent per document", async () => {
    const ctx = syntheticCase();
    const doc = ctx.documents[1]!;
    const { output: facts } = await ai.extractMemoryFacts(ctx, doc);
    const once = mergeMemoryFacts(null, facts, doc);
    const twice = mergeMemoryFacts(once, facts, doc);
    expect(twice.importantLabs).toHaveLength(once.importantLabs.length);
    expect(twice.processedDocumentIds).toEqual(["doc-labs"]);
  });
});
