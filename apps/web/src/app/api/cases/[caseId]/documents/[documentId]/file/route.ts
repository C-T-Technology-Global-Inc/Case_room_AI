import { getSessionUser } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { getDocumentFile } from "@/server/services/documents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Download the original uploaded file (or the extracted text for pasted documents). */
export async function GET(_request: Request, { params }: { params: Promise<{ caseId: string; documentId: string }> }) {
  const { caseId, documentId } = await params;
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  try {
    const file = await getDocumentFile(user, caseId, documentId);
    if (!file) return new Response("Not found", { status: 404 });
    // Only PDFs and plain text are displayed inline; anything else is forced to download
    // so an uploaded file can never execute as active content in the app's origin.
    const inline = /^(application\/pdf|text\/plain)\b/.test(file.contentType);
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": inline ? file.contentType : "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(file.fileName)}"`,
        // Browsers' built-in PDF viewers do not run in sandboxed documents.
        ...(file.contentType.startsWith("application/pdf") ? {} : { "Content-Security-Policy": "default-src 'none'; sandbox" }),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AppError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
