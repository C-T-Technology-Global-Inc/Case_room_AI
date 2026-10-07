import "server-only";
import { randomUUID } from "node:crypto";
import { mergeMemoryFacts, removeDocumentFromMemory, toUserMessage } from "@ccr/ai";
import { prisma } from "@ccr/database";
import type { DocumentType } from "@ccr/types";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_TYPES } from "@ccr/types";
import { z } from "zod";
import type { SessionUser } from "../auth/session";
import { assertCaseAccess } from "../authz/case-access";
import { assertCan } from "../authz/permissions";
import { AppError, ValidationError } from "../errors";
import { realtime } from "../realtime/bus";
import { getStorage } from "../storage";
import { buildCaseContext, getAIProvider } from "./ai";
import { AIRunLostError, bothModelCalls, completeAIRunInTransaction, finishAIRun, startAIRunHeartbeat, type AIRunHeartbeat } from "./ai-quota";
import { recordAudit } from "./audit";
import { updateMemory } from "./memory";
import { postSystemMessage, touchCaseRoom } from "./system-messages";

/** The document itself is stored; only the AI processing (timeline, memory) was not saved. */
const DOCUMENT_RUN_LOST =
  "AI processing was interrupted and its results (timeline events, memory facts) were not saved. The document itself is stored.";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 200_000;

export const documentMetaSchema = z.object({
  title: z.string().trim().min(2, "Give the document a title").max(160),
  type: z.enum(DOCUMENT_TYPES),
  documentDate: z.iso.date("Document date is required"),
});

/** Extract plain text from an uploaded file. Imaging files are not supported (text reports only). */
export async function extractUploadText(file: File): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) throw new ValidationError("File is larger than 10 MB.");
  const name = file.name.toLowerCase();
  const buffer = new Uint8Array(await file.arrayBuffer());

  if (file.type === "application/pdf" || name.endsWith(".pdf")) {
    const { extractText } = await import("unpdf");
    const { text } = await extractText(buffer, { mergePages: true });
    const cleaned = text.replace(/[ \t]+\n/g, "\n").trim();
    if (cleaned.length < 20) {
      throw new ValidationError("No text layer found in this PDF (scanned documents need OCR, which is not part of this MVP). Paste the report text instead.");
    }
    return cleaned;
  }
  if (file.type.startsWith("text/") || /\.(txt|md|csv|rtf)$/.test(name) || file.type === "") {
    return new TextDecoder("utf-8").decode(buffer).trim();
  }
  if (file.type.startsWith("image/") || /\.(dcm|dicom)$/.test(name)) {
    throw new ValidationError("Medical images are not interpreted in this version. Upload the radiology report as text or PDF.");
  }
  throw new ValidationError("Unsupported file type. Upload a PDF or plain-text report.");
}

export async function createDocument(
  user: SessionUser,
  caseRoomId: string,
  input: { title: string; type: DocumentType; documentDate: string; text: string; file?: File | null },
) {
  assertCan(user, "document.upload");
  await assertCaseAccess(user, caseRoomId);
  const meta = documentMetaSchema.parse(input);
  const text = input.text.trim();
  if (text.length < 20) throw new ValidationError("The document text is too short to be useful.");
  if (text.length > MAX_TEXT_CHARS) throw new ValidationError("The document is too long for this MVP (200,000 characters max).");

  let fileKey: string | null = null;
  if (input.file) {
    fileKey = `cases/${caseRoomId}/${randomUUID()}-${input.file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    await getStorage().put(fileKey, Buffer.from(await input.file.arrayBuffer()), input.file.type || "application/octet-stream");
  }

  const document = await prisma.$transaction(async (tx) => {
    const document = await tx.clinicalDocument.create({
      data: {
        caseRoomId,
        type: meta.type,
        title: meta.title,
        rawText: text,
        documentDate: new Date(`${meta.documentDate}T00:00:00Z`),
        uploadedById: user.id,
        fileKey,
        fileName: input.file?.name ?? null,
        mimeType: input.file?.type || (input.file ? "application/octet-stream" : "text/plain"),
        fileSize: input.file?.size ?? Buffer.byteLength(text),
        processingStatus: "PENDING",
      },
    });
    await recordAudit(tx, {
      organizationId: user.organizationId,
      caseRoomId,
      userId: user.id,
      action: "document.uploaded",
      resourceType: "ClinicalDocument",
      resourceId: document.id,
      metadata: { title: document.title, documentType: document.type, fileName: document.fileName },
    });
    await postSystemMessage(tx, {
      caseRoomId,
      content: `${user.name} uploaded ${DOCUMENT_TYPE_LABELS[document.type].toLowerCase()} "${document.title}".`,
      event: "document.uploaded",
      refType: "document",
      refId: document.id,
    });
    await touchCaseRoom(tx, caseRoomId);
    return document;
  });
  await realtime.touch(caseRoomId, ["documents", "messages", "audit"], user.id);
  return document;
}

/**
 * AI post-processing of a new document: extract timeline events and update
 * the shared patient memory. Runs after the upload response (next/server `after`).
 */
export async function processDocument(documentId: string, requestedById: string, aiRunId: string | null = null) {
  const document = await prisma.clinicalDocument.findUnique({ where: { id: documentId }, include: { caseRoom: true } });
  if (!document) {
    if (aiRunId) await finishAIRun(aiRunId, "RELEASED");
    return;
  }
  const { caseRoomId } = document;
  const organizationId = document.caseRoom.organizationId;
  let heartbeat: AIRunHeartbeat | null = null;

  try {
    // Claim the reservation made at upload before touching the document. Each upload hands its
    // run to exactly one processDocument call (retries and re-dispatch come with the durable job
    // queue, which must also make claims exclusive). A run closed meanwhile was presumed
    // abandoned: record that the AI processing did not happen, unless it already completed.
    if (aiRunId) {
      heartbeat = await startAIRunHeartbeat(aiRunId);
      if (!heartbeat) {
        await prisma.$transaction(async (tx) => {
          const { count } = await tx.clinicalDocument.updateMany({
            where: { id: documentId, processingStatus: { not: "COMPLETED" } },
            data: { processingStatus: "FAILED", processingError: DOCUMENT_RUN_LOST },
          });
          if (count === 0) return;
          await recordAudit(tx, {
            organizationId,
            caseRoomId,
            userId: requestedById,
            actorType: "AI",
            action: "ai.document_failed",
            resourceType: "ClinicalDocument",
            resourceId: documentId,
            metadata: { title: document.title, error: "AI run closed before processing started (presumed abandoned)" },
          });
          await touchCaseRoom(tx, caseRoomId);
        });
        await realtime.touch(caseRoomId, ["documents", "audit"]);
        return;
      }
    }
    await prisma.clinicalDocument.update({ where: { id: documentId }, data: { processingStatus: "PROCESSING", processingError: null } });
    await realtime.touch(caseRoomId, ["documents"]);

    try {
      // Inside the try: a misconfigured provider must mark the document FAILED, not leave it queued.
      const provider = getAIProvider();
      const ctx = await buildCaseContext(caseRoomId, requestedById);
      const contextDoc = ctx.documents.find((doc) => doc.id === documentId);
      if (!contextDoc) throw new Error("Document missing from case context");

      const [timeline, facts] = await bothModelCalls(provider.generateTimeline(ctx, [contextDoc]), provider.extractMemoryFacts(ctx, contextDoc));

      // Timeline, memory, status and audit commit together: a failure leaves no partial result behind.
      await prisma.$transaction(
        async (tx) => {
          // Fencing first: a run closed meanwhile rolls everything back.
          if (aiRunId) await completeAIRunInTransaction(tx, aiRunId);
          // Re-processing replaces the AI events previously derived from this document.
          await tx.timelineEvent.deleteMany({ where: { sourceDocumentId: documentId, createdByAI: true } });
          for (const event of timeline.output) {
            await tx.timelineEvent.create({
              data: {
                caseRoomId,
                date: new Date(`${event.date}T00:00:00Z`),
                eventType: event.eventType,
                title: event.title.slice(0, 200),
                description: event.description,
                sourceDocumentId: documentId,
                createdByAI: true,
              },
            });
          }
          await updateMemory(tx, caseRoomId, (memory) => {
            const base = memory.processedDocumentIds.includes(documentId) ? removeDocumentFromMemory(memory, documentId) : memory;
            return mergeMemoryFacts(base, facts.output, contextDoc);
          });
          await tx.clinicalDocument.update({
            where: { id: documentId },
            data: { processingStatus: "COMPLETED", processedAt: new Date() },
          });
          await recordAudit(tx, {
            organizationId,
            caseRoomId,
            userId: requestedById,
            actorType: "AI",
            action: "ai.document_processed",
            resourceType: "ClinicalDocument",
            resourceId: documentId,
            metadata: {
              title: document.title,
              timelineEvents: timeline.output.length,
              provider: timeline.provider.id,
              model: timeline.model,
            },
          });
          await touchCaseRoom(tx, caseRoomId);
        },
        { timeout: 15_000 },
      );
    } catch (error) {
      console.error("[documents] processing failed", error);
      if (aiRunId) await finishAIRun(aiRunId, "FAILED", error);
      await prisma.$transaction(async (tx) => {
        await tx.clinicalDocument.update({
          where: { id: documentId },
          data: {
            processingStatus: "FAILED",
            processingError: error instanceof AIRunLostError ? DOCUMENT_RUN_LOST : error instanceof AppError ? error.message : toUserMessage(error),
          },
        });
        await recordAudit(tx, {
          organizationId,
          caseRoomId,
          userId: requestedById,
          actorType: "AI",
          action: "ai.document_failed",
          resourceType: "ClinicalDocument",
          resourceId: documentId,
          metadata: { title: document.title, error: error instanceof Error ? error.message : String(error) },
        });
        await touchCaseRoom(tx, caseRoomId);
      });
    }
    await realtime.touch(caseRoomId, ["documents", "timeline", "memory", "audit"]);
  } finally {
    heartbeat?.stop();
  }
}

export async function getDocumentFile(user: SessionUser, caseRoomId: string, documentId: string) {
  await assertCaseAccess(user, caseRoomId);
  const document = await prisma.clinicalDocument.findFirst({ where: { id: documentId, caseRoomId } });
  if (!document) return null;
  if (!document.fileKey) {
    return { body: Buffer.from(document.rawText, "utf-8"), contentType: "text/plain; charset=utf-8", fileName: `${document.title}.txt` };
  }
  const body = await getStorage().get(document.fileKey);
  if (!body) return null;
  return { body, contentType: document.mimeType ?? "application/octet-stream", fileName: document.fileName ?? document.title };
}
