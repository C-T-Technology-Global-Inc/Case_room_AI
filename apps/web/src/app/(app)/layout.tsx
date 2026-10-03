import { prisma } from "@ccr/database";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { ActiveOrganizationNotice } from "@/components/layout/organization-switcher";
import { SafetyBanner } from "@/components/layout/safety-banner";
import { requireUser } from "@/server/auth/session";
import { accessibleCaseWhere } from "@/server/authz/case-access";
import { getAIProviderInfo } from "@/server/services/ai";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [openTasks, pendingApprovals] = await Promise.all([
    prisma.task.count({ where: { assignedToId: user.id, status: { not: "DONE" }, caseRoom: accessibleCaseWhere(user) } }),
    prisma.approval.count({
      where: { userId: user.id, status: "PENDING", decision: { status: { in: ["PROPOSED", "UNDER_REVIEW"] } } },
    }),
  ]);
  const ai = getAIProviderInfo();

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <AppSidebar
        user={{ id: user.id, name: user.name, email: user.email, role: user.role, title: user.title }}
        organization={{ id: user.organizationId, name: user.organizationName }}
        organizations={user.organizations}
        counts={{ openTasks, pendingApprovals }}
        ai={{ label: ai.label, model: ai.model, isDemo: ai.isDemo }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <ActiveOrganizationNotice organizationId={user.organizationId} />
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{children}</div>
        <SafetyBanner />
      </div>
    </div>
  );
}
