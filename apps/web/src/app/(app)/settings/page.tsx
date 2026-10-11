import { Badge } from "@ccr/ui/components/badge";
import { Button } from "@ccr/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ccr/ui/components/card";
import { resolveAIConfig } from "@ccr/ai";
import { prisma } from "@ccr/database";
import { USER_ROLE_LABELS } from "@ccr/types";
import { BrainCircuitIcon, DatabaseIcon, FileLockIcon, ScrollTextIcon, ShieldCheckIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { formatDate } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { getAIProviderInfo } from "@/server/services/ai";
import { ChangePasswordForm, ProfileForm, RenameOrganizationForm } from "./account-forms";

export const metadata: Metadata = { title: "Settings" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_minmax(0,1fr)] gap-3 py-2 text-[13px]">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const GUARANTEES = [
  "AI output is always labeled “AI Generated” and stored as a draft.",
  "Only authenticated clinicians can approve decisions, briefs and handoffs; no code path lets the AI approve.",
  "AI answers cite records by key; citations that do not match a real record are removed, and quotes are verified verbatim.",
  "The AI does not diagnose, prescribe, select treatments or triage; it summarizes, organizes and flags gaps.",
  "Content inside documents and messages is treated as data, never as instructions (prompt-injection guard).",
  "The audit log is append-only and enforced by the database.",
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ password?: string }> }) {
  const user = await requireUser();
  const { password } = await searchParams;
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
  const ai = getAIProviderInfo();
  const config = resolveAIConfig();
  const storage = process.env.S3_BUCKET ? `S3-compatible bucket “${process.env.S3_BUCKET}”` : "Local disk (apps/web/.storage)";

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader title="Settings" description="Your profile and password, organization, AI provider and safety configuration." />
      {password === "changed" && (
        <p role="status" className="rounded-md border border-approved-border bg-approved-soft px-3 py-2 text-[13px] text-approved">
          Your password was changed. Your other sessions were signed out.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <Row label="Name">
            {can(user, "org.manage") ? <RenameOrganizationForm organizationId={organization.id} name={organization.name} /> : organization.name}
          </Row>
          <Row label="Created">{formatDate(organization.createdAt)}</Row>
          <Row label="Data">
            <Badge variant="outline">Synthetic demo data only</Badge>
          </Row>
          {can(user, "org.audit") && (
            <Row label="Audit">
              <Button asChild variant="outline" size="sm">
                <Link href="/settings/audit">
                  <ScrollTextIcon />
                  Organization audit log
                </Link>
              </Button>
            </Row>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your profile</CardTitle>
          <CardDescription>
            {user.email} · {USER_ROLE_LABELS[user.role]} in {user.organizationName} · <span className="font-mono">@{user.handle}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm organizationId={user.organizationId} name={user.name} title={user.title} specialty={user.specialty} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Changing your password signs out your other sessions, on every device.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuitIcon className="size-4 text-ai" /> AI provider
          </CardTitle>
          <CardDescription>The AI layer is provider-agnostic. Configure it with environment variables; no code changes are needed.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row label="Active provider">
            <span className="font-medium">{ai.label}</span>
            {ai.isDemo && <Badge variant="draft" className="ml-2">Offline, rule-based</Badge>}
          </Row>
          <Row label="Model">{ai.model}</Row>
          <Row label="Selection">
            <span className="text-muted-foreground">
              AI_PROVIDER={process.env.AI_PROVIDER || "(auto)"} · Anthropic key {config.anthropic.apiKey ? "set" : "not set"} · OpenAI key {config.openai.apiKey ? "set" : "not set"}
            </span>
          </Row>
          <Row label="Configure">
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                Set <code className="rounded bg-muted px-1">ANTHROPIC_API_KEY</code> (default model {config.anthropic.model}) or <code className="rounded bg-muted px-1">OPENAI_API_KEY</code> in the
                root <code className="rounded bg-muted px-1">.env</code>, then restart the server. Without keys the offline demo engine is used.
              </p>
            </div>
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4 text-approved" /> Safety guarantees
          </CardTitle>
          <CardDescription>Clinical Case Room is a collaboration workspace, not an autonomous medical device.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {GUARANTEES.map((item) => (
              <li key={item} className="flex items-start gap-2 text-[13px]">
                <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-approved" />
                {item}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DatabaseIcon className="size-4 text-muted-foreground" /> Storage
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <Row label="Documents">{storage}</Row>
          <Row label="Audit log">
            <span className="inline-flex items-center gap-1.5">
              <FileLockIcon className="size-3.5" /> PostgreSQL, append-only (UPDATE/DELETE blocked by trigger)
            </span>
          </Row>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
