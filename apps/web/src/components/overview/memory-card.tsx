import { Badge } from "@ccr/ui/components/badge";
import { cn } from "@ccr/ui/lib/utils";
import type { CaseMemory } from "@ccr/types";
import { BrainCircuitIcon } from "lucide-react";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { TimeAgo } from "../shared/misc";

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
        <span className="rounded bg-muted px-1 text-[10px] font-medium">{count}</span>
      </div>
      {children}
    </div>
  );
}

function DocLink({ caseId, id, children }: { caseId: string; id: string | null; children: React.ReactNode }) {
  if (!id) return <>{children}</>;
  return (
    <Link href={`/cases/${caseId}/documents?doc=${id}`} className="hover:text-primary hover:underline">
      {children}
    </Link>
  );
}

const TREATMENT_STYLE = {
  planned: "draft",
  active: "default",
  completed: "approved",
  held: "danger",
  unknown: "muted",
} as const;

/** Structured view of the shared patient memory the AI works from. */
export function MemoryCard({ caseId, memory, updatedAt, version }: { caseId: string; memory: CaseMemory; updatedAt: Date; version: number }) {
  // Latest value per lab, most recent first.
  const labs = [...new Map([...memory.importantLabs].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")).map((lab) => [lab.name.toLowerCase(), lab])).values()].reverse();

  return (
    <section className="rounded-xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
        <div className="flex items-center gap-2">
          <BrainCircuitIcon className="size-4 text-ai" />
          <h2 className="text-sm font-semibold">Shared patient memory</h2>
          <Badge variant="muted">v{version}</Badge>
        </div>
        <div className="text-[11.5px] text-muted-foreground">
          Built from {memory.processedDocumentIds.length} documents · updated <TimeAgo date={updatedAt} />
        </div>
      </header>
      <div className="grid gap-5 px-5 py-4 md:grid-cols-2">
        <div className="space-y-4">
          <Group title="Active problems" count={memory.activeProblems.length}>
            <div className="flex flex-wrap gap-1.5">
              {memory.activeProblems.map((problem) => (
                <Badge key={problem} variant="outline" className="font-normal">
                  {problem}
                </Badge>
              ))}
            </div>
          </Group>
          <Group title="Diagnoses" count={memory.diagnoses.length}>
            <ul className="space-y-1 text-[13px]">
              {memory.diagnoses.map((diagnosis) => (
                <li key={diagnosis.name} className="leading-snug">
                  <DocLink caseId={caseId} id={diagnosis.sourceDocumentId}>
                    <span className="font-medium">{diagnosis.name}</span>
                  </DocLink>
                  {diagnosis.date && <span className="text-xs text-muted-foreground"> · {formatDate(diagnosis.date, { year: false })}</span>}
                </li>
              ))}
            </ul>
          </Group>
          <Group title="Treatments" count={memory.treatments.length}>
            <ul className="space-y-1.5 text-[13px]">
              {memory.treatments.map((treatment) => (
                <li key={treatment.name} className="flex items-start justify-between gap-2">
                  <DocLink caseId={caseId} id={treatment.sourceDocumentId}>
                    {treatment.name}
                  </DocLink>
                  <Badge variant={TREATMENT_STYLE[treatment.status]}>{treatment.status}</Badge>
                </li>
              ))}
            </ul>
          </Group>
          <Group title="Medications" count={memory.medications.length}>
            <ul className="space-y-0.5 text-[13px]">
              {memory.medications.map((medication) => (
                <li key={medication.name}>
                  <span className="font-medium">{medication.name}</span> <span className="text-muted-foreground">{medication.detail}</span>
                </li>
              ))}
            </ul>
          </Group>
        </div>
        <div className="space-y-4">
          <Group title="Important labs" count={labs.length}>
            <ul className="divide-y rounded-lg border text-[12.5px]">
              {labs.slice(0, 10).map((lab) => (
                <li key={`${lab.name}-${lab.date}`} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                  <span className="truncate text-muted-foreground">{lab.name}</span>
                  <span className={cn("shrink-0", lab.flag !== "normal" && lab.flag !== "unknown" && "font-semibold text-orange-700")}>
                    <DocLink caseId={caseId} id={lab.sourceDocumentId}>
                      {lab.value}
                    </DocLink>
                    {lab.date && <span className="ml-1.5 font-normal text-muted-foreground">{formatDate(lab.date, { year: false })}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Group>
          <Group title="Imaging" count={memory.importantImaging.length}>
            <ul className="space-y-1.5 text-[13px]">
              {memory.importantImaging.map((study) => (
                <li key={`${study.study}-${study.date}`} className="leading-snug">
                  <DocLink caseId={caseId} id={study.sourceDocumentId}>
                    <span className="font-medium">{study.study}</span>
                  </DocLink>
                  <span className="block text-xs text-muted-foreground">{study.finding}</span>
                </li>
              ))}
            </ul>
          </Group>
          <Group title="Pathology" count={memory.pathology.length}>
            <ul className="space-y-1 text-[13px]">
              {memory.pathology.map((finding) => (
                <li key={`${finding.finding}-${finding.date}`} className="leading-snug">
                  <DocLink caseId={caseId} id={finding.sourceDocumentId}>
                    {finding.finding}
                  </DocLink>
                </li>
              ))}
            </ul>
          </Group>
        </div>
      </div>
    </section>
  );
}
