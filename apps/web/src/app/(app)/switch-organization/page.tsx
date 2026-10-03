import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ccr/ui/components/card";
import { USER_ROLE_LABELS } from "@ccr/types";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SwitchOrganizationButton } from "@/components/layout/organization-switcher";
import { PageContainer } from "@/components/layout/page-header";
import { safePath } from "@/lib/safe-path";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Switch organization" };

/** Shown when a link points to another organization of the signed-in person. */
export default async function SwitchOrganizationPage({ searchParams }: { searchParams: Promise<{ organization?: string; next?: string }> }) {
  const user = await requireUser();
  const { organization, next } = await searchParams;
  const target = user.organizations.find((o) => o.id === organization);
  if (!target) notFound();

  return (
    <PageContainer>
      <Card className="mx-auto mt-16 max-w-md">
        <CardHeader>
          <CardTitle>Open in {target.name}?</CardTitle>
          <CardDescription>
            This page belongs to {target.name}, where you are {USER_ROLE_LABELS[target.role].toLowerCase()}. You are currently working in{" "}
            {user.organizationName}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SwitchOrganizationButton organizationId={target.id} next={safePath(next)} label={`Switch to ${target.name}`} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
