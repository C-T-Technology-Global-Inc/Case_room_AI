import { prisma, toIsoDate } from "@ccr/database";
import { FileTextIcon } from "lucide-react";
import Link from "next/link";
import { DocumentViewer, type ViewerDocument } from "@/components/documents/document-viewer";
import { UploadButton } from "@/components/documents/upload-button";
import { DocumentTypeBadge, ProcessingBadge } from "@/components/shared/badges";
import { EmptyState } from "@/components/shared/empty-state";
import { TimeAgo } from "@/components/shared/misc";
import { UserAvatar } from "@/components/shared/user-avatar";
import { shortName } from "@/lib/activity";
import { formatDate } from "@/lib/format";
import { loadCasePage } from "@/server/case-page";

export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ doc?: string }>;
}) {
  const { caseId } = await loadCasePage(params);
  const { doc } = await searchParams;

  const documents = await prisma.clinicalDocument.findMany({
    where: { caseRoomId: caseId },
    select: {
      id: true,
      title: true,
      type: true,
      documentDate: true,
      createdAt: true,
      fileName: true,
      fileSize: true,
      processingStatus: true,
      uploadedBy: { select: { id: true, name: true } },
      _count: { select: { timelineEvents: true } },
    },
    orderBy: [{ documentDate: "desc" }, { createdAt: "desc" }],
  });

  let selected: ViewerDocument | null = null;
  if (doc) {
    const full = await prisma.clinicalDocument.findFirst({
      where: { id: doc, caseRoomId: caseId },
      include: {
        uploadedBy: { select: { name: true } },
        timelineEvents: { orderBy: { date: "asc" }, select: { id: true, date: true, title: true, eventType: true, createdByAI: true } },
      },
    });
    if (full) {
      selected = {
        id: full.id,
        title: full.title,
        type: full.type,
        documentDate: toIsoDate(full.documentDate),
        uploadedBy: full.uploadedBy.name,
        uploadedAt: full.createdAt.toISOString(),
        rawText: full.rawText,
        fileName: full.fileName,
        processingStatus: full.processingStatus,
        processingError: full.processingError,
        timelineEvents: full.timelineEvents.map((event) => ({ ...event, date: toIsoDate(event.date) })),
      };
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-6 py-6 lg:px-8">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Clinical documents</h2>
          <p className="text-[13px] text-muted-foreground">
            Notes, labs, imaging and pathology reports. Imaging appears as text reports only; the AI never interprets images.
          </p>
        </div>
        <UploadButton />
      </div>

      {documents.length === 0 ? (
        <EmptyState icon={FileTextIcon} title="No documents yet" description="Upload PDF or text reports. The AI extracts timeline events and updates the shared memory automatically." />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <table className="w-full text-[13px]">
            <thead className="border-b bg-muted/40 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2.5">Document</th>
                <th className="px-3 py-2.5">Date</th>
                <th className="px-3 py-2.5">Uploaded by</th>
                <th className="px-3 py-2.5">AI</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {documents.map((document) => (
                <tr key={document.id} className="group hover:bg-accent/40">
                  <td className="px-4 py-3">
                    <Link href={`/cases/${caseId}/documents?doc=${document.id}`} scroll={false} className="flex items-start gap-3">
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <FileTextIcon className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-medium group-hover:text-primary group-hover:underline">{document.title}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <DocumentTypeBadge type={document.type} />
                          {document.fileName && <span className="truncate text-[11px] text-muted-foreground">{document.fileName}</span>}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">{formatDate(document.documentDate)}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <UserAvatar user={document.uploadedBy} size="xs" />
                      <span className="whitespace-nowrap">{shortName(document.uploadedBy.name)}</span>
                    </div>
                    <div className="mt-0.5 pl-7 text-[11px] text-muted-foreground">
                      <TimeAgo date={document.createdAt} />
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <ProcessingBadge status={document.processingStatus} />
                    {document._count.timelineEvents > 0 && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {document._count.timelineEvents} timeline event{document._count.timelineEvents === 1 ? "" : "s"}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DocumentViewer caseId={caseId} document={selected} />
    </div>
  );
}
