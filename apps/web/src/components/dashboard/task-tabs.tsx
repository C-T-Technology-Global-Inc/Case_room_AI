"use client";

import { cn } from "@ccr/ui/lib/utils";
import { CheckCircle2Icon } from "lucide-react";
import { useState, type ReactNode } from "react";

/** Client-side tab switcher for pre-rendered task lists. */
export function TaskTabs({
  tabs,
}: {
  tabs: Array<{ key: string; label: string; count: number; tone?: "danger"; content: ReactNode }>;
}) {
  const [active, setActive] = useState(tabs[0]?.key);
  const current = tabs.find((tab) => tab.key === active) ?? tabs[0];
  return (
    <div>
      <div className="flex gap-1 border-b px-3">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActive(tab.key)}
            className={cn(
              "-mb-px flex cursor-pointer items-center gap-1.5 border-b-2 px-2 py-2 text-[12.5px] font-medium transition-colors",
              tab.key === current?.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            <span
              className={cn(
                "rounded-full px-1.5 text-[10.5px] tabular-nums",
                tab.tone === "danger" && tab.count > 0 ? "bg-red-50 text-red-700" : "bg-muted text-muted-foreground",
              )}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>
      <div className="p-2">
        {current && current.count > 0 ? (
          current.content
        ) : (
          <div className="flex flex-col items-center gap-1.5 py-8 text-center text-[13px] text-muted-foreground">
            <CheckCircle2Icon className="size-5 text-approved" />
            Nothing here. You are all caught up.
          </div>
        )}
      </div>
    </div>
  );
}
