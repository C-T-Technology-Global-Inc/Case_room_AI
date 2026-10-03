import { Badge } from "@ccr/ui/components/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ccr/ui/components/card";
import { USER_ROLE_LABELS } from "@ccr/types";
import type { Metadata } from "next";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { TimeAgo } from "@/components/shared/misc";
import { UserAvatar } from "@/components/shared/user-avatar";
import { formatDate } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { listInvitations, listMembers } from "@/server/services/team";
import { InviteForm, RevokeInvitationButton, RoleSelect } from "./team-admin";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const user = await requireUser();
  const isAdmin = can(user, "org.manage");
  const [members, invitations] = await Promise.all([listMembers(user), listInvitations(user)]);

  return (
    <PageContainer>
      <PageHeader title="Team" description={`${members.length} member${members.length === 1 ? "" : "s"} of ${user.organizationName}. Access to each patient case is limited to its care team.`} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-[13px]">
            <thead className="border-b bg-muted/40 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2.5">Member</th>
                <th className="px-3 py-2.5">Role</th>
                <th className="px-3 py-2.5 text-right">Cases</th>
                <th className="px-4 py-2.5 text-right">Last active</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {members.map((member) => (
                <tr key={member.id} className="hover:bg-accent/30">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <UserAvatar user={member} size="md" />
                      <div className="min-w-0">
                        <div className="font-medium">
                          {member.name}
                          {member.id === user.id && <span className="font-normal text-muted-foreground"> (you)</span>}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {member.title ?? member.specialty ?? "·"} · {member.email} · <span className="font-mono">@{member.handle}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {isAdmin && member.id !== user.id ? (
                      <RoleSelect memberId={member.id} role={member.role} />
                    ) : (
                      <Badge variant={member.role === "ORG_ADMIN" ? "solid" : "secondary"}>{USER_ROLE_LABELS[member.role]}</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{member._count.caseMemberships}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                    {member.lastLoginAt ? <TimeAgo date={member.lastLoginAt} /> : "Never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isAdmin ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Invite a member</CardTitle>
                <CardDescription>Creates a secure, expiring sign-up link for the invitee.</CardDescription>
              </CardHeader>
              <CardContent>
                <InviteForm organizationId={user.organizationId} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Pending invitations</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {invitations.length === 0 && <p className="text-[13px] text-muted-foreground">No pending invitations.</p>}
                {invitations.map((invitation) => (
                  <div key={invitation.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium">{invitation.email}</div>
                      <div className="text-xs text-muted-foreground">
                        {USER_ROLE_LABELS[invitation.role]}
                        {invitation.specialty ? ` · ${invitation.specialty}` : ""} · expires {formatDate(invitation.expiresAt)}
                      </div>
                    </div>
                    <RevokeInvitationButton invitationId={invitation.id} />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Membership</CardTitle>
              <CardDescription>Organization admins invite members and manage roles. Case access is granted per case by the care team.</CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
