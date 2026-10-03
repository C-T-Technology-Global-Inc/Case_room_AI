import { CASE_SPECIALTY_LABELS, type CaseSpecialty } from "@ccr/types";
import { BrainCircuitIcon, CheckSquareIcon, ScaleIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { formatDate, pluralize } from "@/lib/format";
import { DueChip } from "../tasks/task-row";
import { TimeAgo } from "../shared/misc";
import { AIActivityIndicator, CareTeamPanel } from "./right-rail-live";

export interface RightRailProps {
  caseId: string;
  specialty: CaseSpecialty;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  pendingReviews: Array<{ decisionId: string; number: number; title: string }>;
  myTasks: Array<{ id: string; title: string; dueDate: Date | null; status: string }>;
  ai: {
    label: string;
    model: string;
    isDemo: boolean;
    documents: number;
    timeline: number;
    decisions: number;
    tasks: number;
    messages: number;
    memoryUpdatedAt: Date | null;
    memoryVersion: number | null;
  };
}

function RailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

export function CaseRightRail(props: RightRailProps) {
  const { caseId, ai } = props;
  return (
    <aside className="no-print hidden w-80 shrink-0 space-y-6 overflow-y-auto border-l bg-card/60 px-5 py-5 scrollbar-thin xl:block">
      <RailSection title="Case status">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">Specialty</dt>
          <dd className="text-right font-medium">{CASE_SPECIALTY_LABELS[props.specialty]}</dd>
          <dt className="text-muted-foreground">Opened</dt>
          <dd className="text-right">
            {formatDate(props.createdAt)} · {props.createdBy}
          </dd>
          <dt className="text-muted-foreground">Last activity</dt>
          <dd className="text-right">
            <TimeAgo date={props.updatedAt} />
          </dd>
        </dl>
      </RailSection>

      <CareTeamPanel />

      <RailSection title="Pending for you">
        {props.pendingReviews.length === 0 && props.myTasks.length === 0 && <p className="text-[12.5px] text-muted-foreground">Nothing is waiting on you in this case.</p>}
        <ul className="space-y-1.5">
          {props.pendingReviews.map((review) => (
            <li key={review.decisionId}>
              <Link
                href={`/cases/${caseId}/decisions#decision-${review.decisionId}`}
                className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12.5px] text-amber-900 hover:bg-amber-100/70"
              >
                <ScaleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <span className="font-semibold">Review Decision #{review.number}</span>
                  <span className="block text-amber-800/80">{review.title}</span>
                </span>
              </Link>
            </li>
          ))}
          {props.myTasks.map((task) => (
            <li key={task.id}>
              <Link href={`/cases/${caseId}/tasks#task-${task.id}`} className="flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[12.5px] hover:bg-accent">
                <CheckSquareIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{task.title}</span>
                  <DueChip dueDate={task.dueDate} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </RailSection>

      <RailSection title="AI context">
        <div className="space-y-3 rounded-xl border border-ai-border bg-ai-soft/60 p-3">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-ai">
            <BrainCircuitIcon className="size-4" />
            {ai.label}
          </div>
          <p className="text-[12px] leading-relaxed text-foreground/80">
            The assistant answers from this case&apos;s authorized record only: {pluralize(ai.documents, "document")}, {pluralize(ai.timeline, "timeline event")},{" "}
            {pluralize(ai.decisions, "decision")}, {pluralize(ai.tasks, "task")} and the recent discussion ({pluralize(ai.messages, "message")}).
          </p>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Shared memory {ai.memoryVersion ? `v${ai.memoryVersion}` : "not built"}</span>
            {ai.memoryUpdatedAt && (
              <span>
                updated <TimeAgo date={ai.memoryUpdatedAt} />
              </span>
            )}
          </div>
          {!ai.isDemo && <div className="text-[11px] text-muted-foreground">Model: {ai.model}</div>}
          <AIActivityIndicator />
        </div>
      </RailSection>

      <div className="flex items-start gap-2 rounded-xl border border-approved-border bg-approved-soft p-3 text-[12px] leading-relaxed text-approved">
        <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" />
        <span>
          <span className="font-semibold">AI proposes. Humans decide.</span> Clinical decisions become final only after every requested reviewer approves.
        </span>
      </div>
    </aside>
  );
}
