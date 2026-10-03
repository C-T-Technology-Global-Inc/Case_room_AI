import { cn } from "@ccr/ui/lib/utils";
import { LockIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuditTable } from "@/components/audit/audit-table";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { listOrganizationAudit } from "@/server/services/team";

export const metadata: Metadata = { title: "Audit log" };

const FILTERS = [
  { key: "", label: "All" },
  { key: "auth.", label: "Sign-ins" },
  { key: "org.", label: "Organization" },
  { key: "case.", label: "Cases" },
  { key: "ai.", label: "AI" },
  { key: "decision.", label: "Decisions" },
  { key: "document.", label: "Documents" },
  { key: "task.", label: "Tasks" },
] as const;

export default async function OrganizationAuditPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await requireUser();
  if (!can(user, "org.audit")) redirect("/settings");
  const { filter = "" } = await searchParams;
  const active = FILTERS.find((f) => f.key === filter)?.key ?? "";
  const rows = await listOrganizationAudit(user, { action: active || undefined });

  return (
    <PageContainer>
      <PageHeader
        title="Organization audit log"
        description="Every sign-in, upload, AI action, decision, approval and task change across all case rooms."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
            <LockIcon className="size-3.5" /> Append-only
          </span>
        }
      />
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key ? `/settings/audit?filter=${f.key}` : "/settings/audit"}
            className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", active === f.key ? "border-primary bg-primary/10 text-primary" : "bg-card text-muted-foreground hover:text-foreground")}
          >
            {f.label}
          </Link>
        ))}
      </div>
      <AuditTable rows={rows} showCase />
    </PageContainer>
  );
}
