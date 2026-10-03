"use client";

import { USER_ROLE_LABELS } from "@ccr/types";
import { SparklesIcon, UserPlusIcon } from "lucide-react";
import { UserAvatar } from "../shared/user-avatar";
import { useCaseActions } from "./case-actions";
import { useCaseRealtime } from "./realtime-provider";

/** Care team with live presence and typing indicators. */
export function CareTeamPanel() {
  const { members, permissions, openInvite, currentUser } = useCaseActions();
  const { onlineIds, typing, connected } = useCaseRealtime();
  const sorted = [...members].sort((a, b) => Number(onlineIds.has(b.id)) - Number(onlineIds.has(a.id)));
  const onlineCount = members.filter((m) => onlineIds.has(m.id)).length;

  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Care team · {members.length}</h3>
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" title={connected ? "Live updates connected" : "Reconnecting…"}>
          <span className={`size-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-amber-400"}`} />
          {onlineCount} viewing
        </span>
      </div>
      <ul className="space-y-1.5">
        {sorted.map((member) => {
          const isTyping = typing.some((t) => t.userId === member.id);
          const online = onlineIds.has(member.id);
          return (
            <li key={member.id} className="flex items-center gap-2.5">
              <UserAvatar user={member} size="sm" online={online} />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[12.5px] font-medium">
                  {member.name}
                  {member.id === currentUser.id && <span className="font-normal text-muted-foreground"> (you)</span>}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {isTyping ? <span className="text-primary">typing…</span> : (member.specialty ?? USER_ROLE_LABELS[member.role])}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {permissions.manageCase && (
        <button type="button" onClick={openInvite} className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-primary hover:underline">
          <UserPlusIcon className="size-3.5" />
          Invite specialist
        </button>
      )}
    </section>
  );
}

/** Live indicator of AI work in progress (answers, briefs). */
export function AIActivityIndicator() {
  const { aiActivity } = useCaseRealtime();
  if (aiActivity.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {aiActivity.map((activity) => (
        <div key={activity.requestId} className="flex items-center gap-2 rounded-md border border-ai-border bg-ai-soft px-2.5 py-1.5 text-[11.5px] text-ai">
          <SparklesIcon className="size-3.5 animate-pulse" />
          <span className="min-w-0 truncate">{activity.label}…</span>
        </div>
      ))}
    </div>
  );
}
