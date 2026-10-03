"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@ccr/ui/components/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ccr/ui/components/tooltip";
import { cn } from "@ccr/ui/lib/utils";
import type { SourceRef } from "@ccr/types";
import { DOCUMENT_TYPE_LABELS } from "@ccr/types";
import {
  ArrowUpRightIcon,
  CalendarClockIcon,
  CheckSquareIcon,
  FileTextIcon,
  MessageSquareIcon,
  QuoteIcon,
  ScaleIcon,
  ShieldCheckIcon,
} from "lucide-react";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { formatDate } from "@/lib/format";

const KIND_ICON = {
  document: FileTextIcon,
  timeline: CalendarClockIcon,
  decision: ScaleIcon,
  task: CheckSquareIcon,
  message: MessageSquareIcon,
} as const;

export function sourceHref(caseId: string, source: SourceRef): string {
  switch (source.kind) {
    case "document":
      return `/cases/${caseId}/documents?doc=${source.id}`;
    case "timeline":
      return `/cases/${caseId}/timeline#event-${source.id}`;
    case "decision":
      return `/cases/${caseId}/decisions#decision-${source.id}`;
    case "task":
      return `/cases/${caseId}/tasks#task-${source.id}`;
    case "message":
      return `/cases/${caseId}/discussion#message-${source.id}`;
  }
}

function SourceDetails({ caseId, source }: { caseId: string; source: SourceRef }) {
  const Icon = KIND_ICON[source.kind];
  return (
    <div className="space-y-2.5">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-source" />
        <div className="min-w-0">
          <div className="text-[13px] leading-snug font-medium">{source.label}</div>
          <div className="text-xs text-muted-foreground">
            {source.documentType ? `${DOCUMENT_TYPE_LABELS[source.documentType]} · ` : ""}
            {source.date ? formatDate(source.date) : "Undated"}
          </div>
        </div>
      </div>
      {source.excerpt && (
        <blockquote className="rounded-md border-l-2 border-source bg-source-soft px-2.5 py-2 text-xs leading-relaxed text-foreground/90">
          <QuoteIcon className="mb-1 size-3 text-source" />
          {source.excerpt}
          {source.verified && (
            <div className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-approved">
              <ShieldCheckIcon className="size-3" /> Excerpt verified verbatim in the source
            </div>
          )}
        </blockquote>
      )}
      <Link href={sourceHref(caseId, source)} className="inline-flex items-center gap-1 text-xs font-medium text-source hover:underline">
        Open source <ArrowUpRightIcon className="size-3" />
      </Link>
    </div>
  );
}

export function SourceChip({ caseId, source, index }: { caseId: string; source: SourceRef; index?: number }) {
  const Icon = KIND_ICON[source.kind];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md border border-source-border bg-source-soft px-2 py-1 text-left text-xs text-source transition-colors hover:bg-source-soft/60"
        >
          {index !== undefined && (
            <span className="inline-flex size-4 shrink-0 items-center justify-center rounded bg-source/10 text-[10px] font-semibold">{index}</span>
          )}
          <Icon className="size-3.5 shrink-0" />
          <span className="truncate font-medium">{source.label}</span>
          {source.date && <span className="shrink-0 text-source/70">· {formatDate(source.date, { year: false })}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <SourceDetails caseId={caseId} source={source} />
      </PopoverContent>
    </Popover>
  );
}

export function SourceList({ caseId, sources, label = "Sources" }: { caseId: string; sources: SourceRef[]; label?: string }) {
  if (sources.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((source, index) => (
          <SourceChip key={`${source.kind}-${source.id}`} caseId={caseId} source={source} index={index + 1} />
        ))}
      </div>
    </div>
  );
}

function CitationMarker({ caseId, n, source }: { caseId: string; n: number; source: SourceRef | undefined }) {
  if (!source) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={sourceHref(caseId, source)}
          className="relative -top-px ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-source/10 px-1 align-middle text-[10px] font-semibold text-source no-underline hover:bg-source/20"
        >
          {n}
        </Link>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <div className="font-medium">{source.label}</div>
        {source.date && <div className="text-white/70">{formatDate(source.date)}</div>}
        {source.excerpt && <div className="mt-1 text-white/90 italic">“{source.excerpt}”</div>}
      </TooltipContent>
    </Tooltip>
  );
}

function renderInline(text: string, caseId: string, sources: SourceRef[]): ReactNode[] {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, index) => {
    const match = /^\[(\d+)\]$/.exec(part);
    if (match) {
      const n = Number(match[1]);
      return <CitationMarker key={index} caseId={caseId} n={n} source={sources[n - 1]} />;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

/**
 * Renders AI or brief text: "- " lines become bullets, "1. " lines numbered
 * items, other lines paragraphs; "[n]" markers become evidence chips.
 */
export function RichText({ text, caseId, sources = [], className }: { text: string; caseId: string; sources?: SourceRef[]; className?: string }) {
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
  const blocks: Array<{ type: "p" | "ul" | "ol"; items: string[] }> = [];
  for (const line of lines) {
    const bullet = /^\s*[-•*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const type = bullet ? "ul" : numbered ? "ol" : "p";
    const content = bullet?.[1] ?? numbered?.[1] ?? line;
    const last = blocks.at(-1);
    if (type !== "p" && last?.type === type) last.items.push(content);
    else blocks.push({ type, items: [content] });
  }

  return (
    <div className={cn("space-y-2 text-sm leading-relaxed", className)}>
      {blocks.map((block, index) => {
        if (block.type === "p") {
          return <p key={index}>{renderInline(block.items[0]!, caseId, sources)}</p>;
        }
        const List = block.type === "ul" ? "ul" : "ol";
        return (
          <List key={index} className={cn("space-y-1 pl-5", block.type === "ul" ? "list-disc marker:text-muted-foreground/60" : "list-decimal marker:text-muted-foreground")}>
            {block.items.map((item, i) => (
              <li key={i} className="pl-0.5">
                {renderInline(item, caseId, sources)}
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
