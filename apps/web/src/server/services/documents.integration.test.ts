import * as ai from "@ccr/ai";
import { prisma } from "@ccr/database";
import { parseCaseMemory } from "@ccr/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCareTeam, resetDatabase } from "@/test/integration/fixtures";
import { createDocument, processDocument } from "./documents";

vi.mock("@/server/realtime/bus", () => ({ realtime: { touch: vi.fn(async () => {}), publish: vi.fn(async () => {}) } }));
vi.mock("@ccr/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ccr/ai")>();
  return { ...actual, mergeMemoryFacts: vi.fn(actual.mergeMemoryFacts) };
});

type Team = Awaited<ReturnType<typeof createCareTeam>>;
let team: Team;

beforeEach(async () => {
  await resetDatabase();
  team = await createCareTeam();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const report = (title: string, text: string, documentDate: string) =>
  createDocument(team.proposer, team.caseRoom.id, { title, type: "LAB_RESULT", documentDate, text });

describe("document processing is atomic (finding 11)", () => {
  it("commits nothing but the failure when the memory update fails", async () => {
    const document = await report("Synthetic labs", "CA 19-9: 980 U/mL (reference < 37). Bilirubin 1.1 mg/dL. Synthetic laboratory report.", "2026-09-03");
    vi.mocked(ai.mergeMemoryFacts).mockImplementationOnce(() => {
      throw new Error("injected memory failure");
    });
    await processDocument(document.id, team.proposer.id);

    const stored = await prisma.clinicalDocument.findUniqueOrThrow({ where: { id: document.id } });
    expect(stored.processingStatus).toBe("FAILED");
    expect(await prisma.timelineEvent.count({ where: { sourceDocumentId: document.id } })).toBe(0);
    const actions = (await prisma.auditEvent.findMany({ where: { resourceId: document.id } })).map((a) => a.action);
    expect(actions).toContain("ai.document_failed");
    expect(actions).not.toContain("ai.document_processed");
  });

  it("merges concurrent documents into the shared memory without losing either", async () => {
    const first = await report("Synthetic labs", "CA 19-9: 980 U/mL (reference < 37). Synthetic laboratory report one.", "2026-09-03");
    const second = await report("Synthetic labs 2", "CEA: 4.1 ng/mL (reference < 3.0). Synthetic laboratory report two.", "2026-09-04");
    await Promise.all([processDocument(first.id, team.proposer.id), processDocument(second.id, team.proposer.id)]);

    const statuses = await prisma.clinicalDocument.findMany({ where: { caseRoomId: team.caseRoom.id }, select: { processingStatus: true } });
    expect(statuses.map((s) => s.processingStatus)).toEqual(["COMPLETED", "COMPLETED"]);
    const memory = await prisma.caseMemory.findUniqueOrThrow({ where: { caseRoomId: team.caseRoom.id } });
    expect(parseCaseMemory(memory.data)?.processedDocumentIds.sort()).toEqual([first.id, second.id].sort());
    expect(memory.version).toBe(2);
  });
});
