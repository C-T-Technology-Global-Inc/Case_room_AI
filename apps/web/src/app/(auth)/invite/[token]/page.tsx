import { USER_ROLE_LABELS } from "@ccr/types";
import type { Metadata } from "next";
import Link from "next/link";
import { getSessionIdentityId } from "@/server/auth/session";
import { describeInvitation } from "@/server/services/team";
import { AcceptInviteForm, JoinOrganizationButton, SwitchAccountButton } from "./accept-form";

export const metadata: Metadata = { title: "Join organization" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await describeInvitation(token, await getSessionIdentityId());

  if (view.state === "unavailable") {
    return (
      <div className="w-full max-w-md space-y-3 text-center">
        <h2 className="text-xl font-semibold">Invitation not available</h2>
        <p className="text-[13px] text-muted-foreground">This invitation link is invalid, was revoked or has expired. Ask your organization admin for a new one.</p>
        <Link href="/login" className="text-[13px] font-medium text-primary hover:underline">
          Go to sign in
        </Link>
      </div>
    );
  }

  const { invitation } = view;
  const organizationName = invitation.organization.name;
  return (
    <div className="w-full max-w-md space-y-8">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Join {organizationName}</h2>
        <p className="text-[13px] text-muted-foreground">
          {invitation.invitedBy.name} invited <span className="font-medium text-foreground">{invitation.email}</span> as{" "}
          {USER_ROLE_LABELS[invitation.role]}
          {invitation.specialty ? ` (${invitation.specialty})` : ""}.
        </p>
      </div>

      {view.state === "create-account" && <AcceptInviteForm token={token} />}

      {view.state === "sign-in" && (
        <div className="space-y-3 text-[13px]">
          <p className="text-muted-foreground">
            You already have a Clinical Case Room account. Sign in to add {organizationName} to your organizations.
          </p>
          <Link
            href={`/login?${new URLSearchParams({ callbackUrl: `/invite/${token}` })}`}
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90"
          >
            Sign in to accept
          </Link>
        </div>
      )}

      {view.state === "join" && (
        <div className="space-y-3 text-[13px]">
          <p className="text-muted-foreground">
            You are signed in as <span className="font-medium text-foreground">{view.signedInAs}</span>. Your other organizations stay as they are; switch between them from the
            sidebar.
          </p>
          <JoinOrganizationButton token={token} organizationName={organizationName} />
        </div>
      )}

      {view.state === "already-member" && (
        <div className="space-y-3 text-[13px] text-muted-foreground">
          <p>You are already a member of {organizationName}. Switch to it from the organization menu in the sidebar.</p>
          <Link href="/dashboard" className="font-medium text-primary hover:underline">
            Go to the dashboard
          </Link>
        </div>
      )}

      {view.state === "wrong-account" && (
        <div className="space-y-3 text-[13px]">
          <p className="text-muted-foreground">
            This invitation was sent to {invitation.email}, but you are signed in as {view.signedInAs ?? "another account"}.
          </p>
          <SwitchAccountButton token={token} />
        </div>
      )}
    </div>
  );
}
