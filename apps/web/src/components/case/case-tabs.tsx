"use client";

import { cn } from "@ccr/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface CaseTabCounts {
  timeline: number;
  discussion: number;
  documents: number;
  decisions: number;
  tasks: number;
}

export function CaseTabs({ caseId, counts }: { caseId: string; counts: CaseTabCounts }) {
  const pathname = usePathname();
  const base = `/cases/${caseId}`;
  const tabs = [
    { href: base, label: "Overview" },
    { href: `${base}/timeline`, label: "Timeline", count: counts.timeline },
    { href: `${base}/discussion`, label: "Discussion", count: counts.discussion },
    { href: `${base}/documents`, label: "Documents", count: counts.documents },
    { href: `${base}/decisions`, label: "Decisions", count: counts.decisions, highlight: counts.decisions > 0 },
    { href: `${base}/tasks`, label: "Tasks", count: counts.tasks },
    { href: `${base}/tumor-board`, label: "Tumor Board" },
    { href: `${base}/handoff`, label: "Handoff" },
    { href: `${base}/audit`, label: "Audit Log" },
  ];

  return (
    <nav className="no-print -mb-px flex gap-1 overflow-x-auto border-b bg-card px-5 scrollbar-thin lg:px-7" aria-label="Case sections">
      {tabs.map((tab) => {
        const active = tab.href === base ? pathname === base : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors",
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10.5px] font-semibold tabular-nums",
                  tab.highlight ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground",
                )}
              >
                {tab.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
