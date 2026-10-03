import { prisma, toIsoDate } from "@ccr/database";
import type { Metadata } from "next";
import { CaseActionsProvider, type CaseClientData } from "@/components/case/case-actions";
import { CaseHeader } from "@/components/case/case-header";
import { CaseTabs } from "@/components/case/case-tabs";
import { CaseRealtimeProvider } from "@/components/case/realtime-provider";
import { CaseRightRail } from "@/components/case/right-rail";
import { shortName } from "@/lib/activity";
import { ageFromDob } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { findAccessibleCase, requireCaseForPage } from "@/server/authz/case-access";
import { can } from "@/server/authz/permissions";
import { getAIProviderInfo } from "@/server/services/ai";
import { getCaseRoomOverview, listOrganizationMembers } from "@/server/services/cases";

export async function generateMetadata({ params }: { params: Promise<{ caseId: string }> }): Promise<Metadata> {
  const { caseId } = await params;
  const user = await requireUser();
  // Same membership check as the page: metadata is rendered even when the page itself is a 404.
  const room = await findAccessibleCase(user, caseId);
  return { title: room ? `${room.patient.firstName} ${room.patient.lastName}` : "Case" };
}

export default async function CaseLayout({ children, params }: { children: React.ReactNode; params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const user = await requireUser();
  await requireCaseForPage(user, caseId);

  const [room, documents, organizationMembers, pendingReviews, myTasks, messageCount, decisionCount] = await Promise.all([
    getCaseRoomOverview(user, caseId),
    prisma.clinicalDocument.findMany({
      where: { caseRoomId: caseId },
      select: { id: true, title: true, type: true, documentDate: true },
      orderBy: { documentDate: "desc" },
    }),
    can(user, "case.manage") ? listOrganizationMembers(user) : Promise.resolve([]),
    prisma.approval.findMany({
      where: { userId: user.id, status: "PENDING", decision: { caseRoomId: caseId, status: { in: ["PROPOSED", "UNDER_REVIEW"] } } },
      include: { decision: { select: { id: true, number: true, title: true } } },
    }),
    prisma.task.findMany({
      where: { caseRoomId: caseId, assignedToId: user.id, status: { not: "DONE" } },
      select: { id: true, title: true, dueDate: true, status: true },
      orderBy: { dueDate: { sort: "asc", nulls: "last" } },
      take: 4,
    }),
    prisma.message.count({ where: { caseRoomId: caseId, type: { not: "SYSTEM" } } }),
    prisma.decision.count({ where: { caseRoomId: caseId } }),
  ]);
  const ai = getAIProviderInfo();
  const patient = room.patient;

  const clientData: CaseClientData = {
    caseId,
    caseTitle: room.title,
    patientName: `${patient.firstName} ${patient.lastName}`,
    currentUser: { id: user.id, name: user.name, role: user.role },
    permissions: {
      manageCase: can(user, "case.manage"),
      uploadDocument: can(user, "document.upload"),
      editTimeline: can(user, "timeline.edit"),
      postMessage: can(user, "message.post"),
      askAI: can(user, "ai.ask"),
      generateBrief: can(user, "brief.generate"),
      approveBrief: can(user, "brief.approve"),
      generateHandoff: can(user, "handoff.generate"),
      approveHandoff: can(user, "handoff.approve"),
      createDecision: can(user, "decision.create"),
      reviewDecision: can(user, "decision.review"),
      manageTasks: can(user, "task.manage"),
    },
    members: room.members.map((m) => m.user),
    documents: documents.map((d) => ({ id: d.id, title: d.title, type: d.type, date: toIsoDate(d.documentDate) })),
    organizationMembers,
  };

  return (
    <CaseRealtimeProvider caseId={caseId} currentUser={{ id: user.id, name: user.name }} version={room.updatedAt.toISOString()}>
      <CaseActionsProvider data={clientData}>
        <div className="flex h-full min-h-0 flex-col">
          <CaseHeader
            title={room.title}
            status={room.status}
            specialty={room.specialty}
            patient={{
              name: `${patient.firstName} ${patient.lastName}`,
              age: ageFromDob(patient.dateOfBirth),
              sex: patient.sex,
              mrn: patient.syntheticMedicalRecordNumber,
              dateOfBirth: toIsoDate(patient.dateOfBirth),
              primaryDiagnosis: patient.primaryDiagnosis,
            }}
          />
          <CaseTabs
            caseId={caseId}
            counts={{
              timeline: room._count.timeline,
              discussion: messageCount,
              documents: room._count.documents,
              decisions: room._count.decisions,
              tasks: room._count.tasks,
            }}
          />
          <div className="flex min-h-0 flex-1">
            <div id="case-main" className="min-w-0 flex-1 overflow-y-auto scrollbar-thin">
              {children}
            </div>
            <CaseRightRail
              caseId={caseId}
              specialty={room.specialty}
              createdAt={room.createdAt}
              createdBy={shortName(room.createdBy.name)}
              updatedAt={room.updatedAt}
              pendingReviews={pendingReviews.map((p) => ({ decisionId: p.decision.id, number: p.decision.number, title: p.decision.title }))}
              myTasks={myTasks}
              ai={{
                label: ai.label,
                model: ai.model,
                isDemo: ai.isDemo,
                documents: room._count.documents,
                timeline: room._count.timeline,
                decisions: decisionCount,
                tasks: room._count.tasks,
                messages: Math.min(messageCount, 40),
                memoryUpdatedAt: room.memory?.updatedAt ?? null,
                memoryVersion: room.memory?.version ?? null,
              }}
            />
          </div>
        </div>
      </CaseActionsProvider>
    </CaseRealtimeProvider>
  );
}
