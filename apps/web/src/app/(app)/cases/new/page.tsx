import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { listOrganizationMembers } from "@/server/services/cases";
import { NewCaseForm } from "./new-case-form";

export const metadata: Metadata = { title: "New case room" };

export default async function NewCasePage() {
  const user = await requireUser();
  if (!can(user, "case.create")) redirect("/cases");
  const members = await listOrganizationMembers(user);
  return (
    <PageContainer className="max-w-4xl">
      <PageHeader title="New case room" description="One shared workspace per patient: records, discussion, AI assistance, decisions and tasks." />
      <NewCaseForm members={members.filter((m) => m.id !== user.id)} organizationId={user.organizationId} />
    </PageContainer>
  );
}
