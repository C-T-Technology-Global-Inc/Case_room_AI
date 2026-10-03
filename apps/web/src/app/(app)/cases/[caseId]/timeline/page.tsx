import { cn } from "@ccr/ui/lib/utils";
import { TIMELINE_EVENT_TYPE_LABELS, TIMELINE_EVENT_TYPES, type TimelineEventType } from "@ccr/types";
import { CalendarClockIcon, FileTextIcon, UserIcon } from "lucide-react";
import Link from "next/link";
import { AIGeneratedBadge } from "@/components/shared/badges";
import { EmptyState } from "@/components/shared/empty-state";
import { TimelineActions } from "@/components/timeline/timeline-actions";
import { TimelineEventIcon } from "@/components/timeline/event-icon";
import { shortName } from "@/lib/activity";
import { loadCasePage } from "@/server/case-page";
import { listTimeline } from "@/server/services/timeline";

export default async function TimelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { user, caseId } = await loadCasePage(params);
  const { type } = await searchParams;
  const all = await listTimeline(user, caseId);
  const filter = TIMELINE_EVENT_TYPES.includes(type as TimelineEventType) ? (type as TimelineEventType) : null;
  const events = filter ? all.filter((event) => event.eventType === filter) : all;
  const presentTypes = TIMELINE_EVENT_TYPES.filter((t) => all.some((event) => event.eventType === t));

  const groups = new Map<string, typeof events>();
  for (const event of events) {
    const key = event.date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-6 py-6 lg:px-8">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Patient timeline</h2>
          <p className="text-[13px] text-muted-foreground">Extracted by AI from uploaded records and linked to each source. Most recent first.</p>
        </div>
        <TimelineActions caseId={caseId} />
      </div>

      {presentTypes.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <Link
            href={`/cases/${caseId}/timeline`}
            className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", !filter ? "border-primary bg-primary/10 text-primary" : "bg-card text-muted-foreground hover:text-foreground")}
          >
            All · {all.length}
          </Link>
          {presentTypes.map((t) => (
            <Link
              key={t}
              href={`/cases/${caseId}/timeline?type=${t}`}
              className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", filter === t ? "border-primary bg-primary/10 text-primary" : "bg-card text-muted-foreground hover:text-foreground")}
            >
              {TIMELINE_EVENT_TYPE_LABELS[t]}
            </Link>
          ))}
        </div>
      )}

      {events.length === 0 ? (
        <EmptyState icon={CalendarClockIcon} title="No timeline events yet" description="Upload clinical documents; the AI extracts dated events automatically and links each one to its source." />
      ) : (
        <div className="space-y-8">
          {[...groups.entries()].map(([month, monthEvents]) => (
            <section key={month}>
              <h3 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{month}</h3>
              <ol className="relative space-y-3">
                <span aria-hidden className="absolute top-2 bottom-2 left-[89px] w-px bg-border" />
                {monthEvents.map((event) => (
                  <li key={event.id} id={`event-${event.id}`} className="relative flex scroll-mt-24 gap-4">
                    <div className="w-[70px] shrink-0 pt-1.5 text-right">
                      <div className="text-[13px] font-semibold tabular-nums">
                        {event.date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {event.date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}
                      </div>
                    </div>
                    <TimelineEventIcon type={event.eventType} className="relative z-10 mt-0.5 ring-4 ring-background" />
                    <div className="min-w-0 flex-1 rounded-xl border bg-card px-4 py-3 target:ring-2 target:ring-primary/40">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="text-[13.5px] font-semibold leading-snug">{event.title}</div>
                        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{TIMELINE_EVENT_TYPE_LABELS[event.eventType]}</span>
                      </div>
                      <p className="mt-1 text-[13px] leading-relaxed text-foreground/85">{event.description}</p>
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        {event.sourceDocument && (
                          <Link
                            href={`/cases/${caseId}/documents?doc=${event.sourceDocument.id}`}
                            className="inline-flex items-center gap-1.5 rounded-md border border-source-border bg-source-soft px-2 py-0.5 text-xs font-medium text-source hover:underline"
                          >
                            <FileTextIcon className="size-3.5" />
                            {event.sourceDocument.title}
                          </Link>
                        )}
                        {event.createdByAI ? (
                          <AIGeneratedBadge />
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                            <UserIcon className="size-3" />
                            Added by {event.createdBy ? shortName(event.createdBy.name) : "the care team"}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
