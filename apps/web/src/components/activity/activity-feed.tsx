import { cn } from "@ccr/ui/lib/utils";
import type { ActorType } from "@ccr/types";
import {
  BuildingIcon,
  CheckSquareIcon,
  FileCheck2Icon,
  FileTextIcon,
  FolderHeartIcon,
  KeyRoundIcon,
  MessageSquareIcon,
  ScaleIcon,
  SparklesIcon,
} from "lucide-react";
import Link from "next/link";
import { describeActivity, type ActivityKind } from "@/lib/activity";
import { TimeAgo } from "../shared/misc";

const KIND_STYLE: Record<ActivityKind, { icon: typeof SparklesIcon; className: string }> = {
  ai: { icon: SparklesIcon, className: "bg-ai-soft text-ai" },
  decision: { icon: ScaleIcon, className: "bg-amber-50 text-amber-700" },
  document: { icon: FileTextIcon, className: "bg-sky-50 text-sky-700" },
  task: { icon: CheckSquareIcon, className: "bg-emerald-50 text-emerald-700" },
  case: { icon: FolderHeartIcon, className: "bg-slate-100 text-slate-600" },
  brief: { icon: FileCheck2Icon, className: "bg-approved-soft text-approved" },
  message: { icon: MessageSquareIcon, className: "bg-slate-100 text-slate-600" },
  auth: { icon: KeyRoundIcon, className: "bg-slate-100 text-slate-500" },
  org: { icon: BuildingIcon, className: "bg-slate-100 text-slate-600" },
};

export interface ActivityItem {
  id: string;
  action: string;
  actorType: ActorType;
  metadata: unknown;
  createdAt: Date;
  user: { name: string } | null;
  caseRoom?: { id: string; patient: { firstName: string; lastName: string } } | null;
}

export function ActivityFeed({ items, showCase = true, compact = false }: { items: ActivityItem[]; showCase?: boolean; compact?: boolean }) {
  return (
    <ol className="relative space-y-0">
      {items.map((item, index) => {
        const { text, kind } = describeActivity(item);
        const style = KIND_STYLE[kind];
        return (
          <li key={item.id} className="relative flex gap-3 pb-4 last:pb-0">
            {index < items.length - 1 && <span aria-hidden className="absolute top-7 bottom-0 left-[13px] w-px bg-border" />}
            <span className={cn("relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full", style.className)}>
              <style.icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className={cn("leading-snug text-foreground/90", compact ? "text-[12.5px]" : "text-[13px]")}>{text}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {item.actorType === "AI" && <span className="font-medium text-ai">AI</span>}
                {item.actorType === "SYSTEM" && <span className="font-medium">System</span>}
                {item.actorType !== "USER" && <span>·</span>}
                <TimeAgo date={item.createdAt} />
                {showCase && item.caseRoom && (
                  <>
                    <span>·</span>
                    <Link href={`/cases/${item.caseRoom.id}`} className="truncate hover:text-primary hover:underline">
                      {item.caseRoom.patient.firstName} {item.caseRoom.patient.lastName}
                    </Link>
                  </>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
