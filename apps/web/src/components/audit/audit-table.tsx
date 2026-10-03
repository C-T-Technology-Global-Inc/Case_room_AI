import { Badge } from "@ccr/ui/components/badge";
import { cn } from "@ccr/ui/lib/utils";
import type { ActorType } from "@ccr/types";
import { BotIcon, CogIcon } from "lucide-react";
import Link from "next/link";
import { describeActivity } from "@/lib/activity";
import { formatDateTime } from "@/lib/format";
import { UserAvatar } from "../shared/user-avatar";

export interface AuditRow {
  id: string;
  action: string;
  actorType: ActorType;
  resourceType: string;
  resourceId: string | null;
  metadata: unknown;
  createdAt: Date;
  user: { name: string } | null;
  userId?: string | null;
  caseRoom?: { id: string; title: string; patient: { firstName: string; lastName: string } } | null;
}

function MetadataCell({ metadata }: { metadata: unknown }) {
  if (!metadata || typeof metadata !== "object") return <span className="text-muted-foreground">·</span>;
  const entries = Object.entries(metadata as Record<string, unknown>).filter(([, value]) => value !== null && value !== undefined && value !== "");
  if (entries.length === 0) return <span className="text-muted-foreground">·</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.slice(0, 4).map(([key, value]) => (
        <span key={key} className="max-w-56 truncate rounded bg-muted px-1.5 py-px font-mono text-[10.5px] text-muted-foreground" title={`${key}: ${JSON.stringify(value)}`}>
          {key}={typeof value === "string" ? value : JSON.stringify(value)}
        </span>
      ))}
    </div>
  );
}

/** Read-only rendering of append-only audit events (no edit or delete affordances by design). */
export function AuditTable({ rows, showCase = false }: { rows: AuditRow[]; showCase?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-[12.5px]">
        <thead className="border-b bg-muted/40 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          <tr>
            <th className="px-4 py-2.5 whitespace-nowrap">Time</th>
            <th className="px-3 py-2.5">Actor</th>
            <th className="px-3 py-2.5">Event</th>
            {showCase && <th className="px-3 py-2.5">Case</th>}
            <th className="px-3 py-2.5">Action</th>
            <th className="px-3 py-2.5">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => {
            const { text } = describeActivity(row);
            return (
              <tr key={row.id} className="align-top hover:bg-accent/30">
                <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground tabular-nums">{formatDateTime(row.createdAt)}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    {row.actorType === "AI" ? (
                      <span className="flex size-5 items-center justify-center rounded-full bg-ai text-white">
                        <BotIcon className="size-3" />
                      </span>
                    ) : row.actorType === "SYSTEM" ? (
                      <span className="flex size-5 items-center justify-center rounded-full bg-slate-500 text-white">
                        <CogIcon className="size-3" />
                      </span>
                    ) : (
                      <UserAvatar user={{ id: row.userId ?? row.user?.name ?? "?", name: row.user?.name ?? "Unknown" }} size="xs" />
                    )}
                    <span className={cn(row.actorType === "AI" && "font-medium text-ai")}>
                      {row.actorType === "AI" ? "AI" : row.actorType === "SYSTEM" ? "System" : (row.user?.name ?? "Unknown")}
                    </span>
                  </div>
                  {row.actorType !== "USER" && row.user && <div className="mt-0.5 pl-7 text-[11px] text-muted-foreground">for {row.user.name}</div>}
                </td>
                <td className="max-w-md px-3 py-2.5 leading-snug">{text}</td>
                {showCase && (
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {row.caseRoom ? (
                      <Link href={`/cases/${row.caseRoom.id}/audit`} className="hover:text-primary hover:underline">
                        {row.caseRoom.patient.firstName} {row.caseRoom.patient.lastName}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Organization</span>
                    )}
                  </td>
                )}
                <td className="px-3 py-2.5">
                  <Badge variant="outline" className="font-mono text-[10.5px] font-normal">
                    {row.action}
                  </Badge>
                </td>
                <td className="px-3 py-2.5">
                  <MetadataCell metadata={row.metadata} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
