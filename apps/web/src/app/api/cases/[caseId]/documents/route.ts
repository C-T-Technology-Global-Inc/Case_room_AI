import { DOCUMENT_TYPES, type DocumentType } from "@ccr/types";
import { revalidatePath } from "next/cache";
import { after, NextResponse } from "next/server";
import { ZodError } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { assertCaseAccess } from "@/server/authz/case-access";
import { assertCan } from "@/server/authz/permissions";
import { AppError, ForbiddenError, NotFoundError, PayloadTooLargeError, RateLimitError, ValidationError } from "@/server/errors";
import { readFormDataWithLimit } from "@/server/http/limited-body";
import { envLimit } from "@/server/rate-limit";
import { finishAIRun, reserveAIRun } from "@/server/services/ai-quota";
import { createDocument, extractUploadText, MAX_UPLOAD_BYTES, processDocument } from "@/server/services/documents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** File limit plus room for the pasted-text field (200,000 characters) and multipart framing. */
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;
const MAX_FORM_FIELDS = 8;

// Uploads being read and extracted in this process: bounds memory use (body, form parsing, PDF text extraction).
const globalForUploads = globalThis as unknown as { __ccrActiveUploads?: number };
const maxConcurrentUploads = () => envLimit("MAX_CONCURRENT_UPLOADS", 4);

/**
 * Upload a clinical document (PDF / text file, or pasted text).
 * Permission, case membership and the AI quota are checked before the body is
 * read; the body is read with a hard byte limit. Text is extracted
 * synchronously; AI processing (timeline + shared memory) runs after the
 * response is sent and is broadcast to viewers when done.
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let aiRunId: string | null = null;
  let handedToProcessing = false;
  let holdsSlot = false;
  try {
    assertCan(user, "document.upload");
    await assertCaseAccess(user, caseId);
    const active = globalForUploads.__ccrActiveUploads ?? 0;
    if (maxConcurrentUploads() > 0 && active >= maxConcurrentUploads()) {
      throw new RateLimitError("The server is busy with other uploads. Try again in a moment.");
    }
    globalForUploads.__ccrActiveUploads = active + 1;
    holdsSlot = true;
    // Every upload triggers AI processing (two model calls): reserve that budget before reading the body.
    aiRunId = (await reserveAIRun(user, { task: "document", units: 2 })).id;

    const form = await readFormDataWithLimit(request, MAX_REQUEST_BYTES);
    if ([...form.keys()].length > MAX_FORM_FIELDS || form.getAll("file").length > 1) {
      throw new ValidationError("Upload one file per document.");
    }
    const file = form.get("file");
    const upload = file instanceof File && file.size > 0 ? file : null;
    const pasted = String(form.get("text") ?? "");
    const type = String(form.get("type") ?? "OTHER");

    const text = upload ? await extractUploadText(upload) : pasted;
    const document = await createDocument(user, caseId, {
      title: String(form.get("title") ?? ""),
      type: (DOCUMENT_TYPES as readonly string[]).includes(type) ? (type as DocumentType) : "OTHER",
      documentDate: String(form.get("documentDate") ?? ""),
      text,
      file: upload,
    });

    const runId = aiRunId;
    after(() => processDocument(document.id, user.id, runId));
    handedToProcessing = true;
    revalidatePath(`/cases/${caseId}`, "layout");
    return NextResponse.json({ id: document.id, characters: text.length }, { status: 201 });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: error.message }, { status: 413 });
    if (error instanceof RateLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    console.error("[upload]", error);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  } finally {
    if (holdsSlot) globalForUploads.__ccrActiveUploads = Math.max(0, (globalForUploads.__ccrActiveUploads ?? 1) - 1);
    // Nothing was sent to the model: give the reserved budget back.
    if (aiRunId && !handedToProcessing) await finishAIRun(aiRunId, "RELEASED");
  }
}
