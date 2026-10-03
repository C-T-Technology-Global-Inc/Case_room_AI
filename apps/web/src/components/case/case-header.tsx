"use client";

import { Button } from "@ccr/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ccr/ui/components/dropdown-menu";
import { cn } from "@ccr/ui/lib/utils";
import type { CaseSpecialty, CaseStatus, PatientSex } from "@ccr/types";
import { CASE_SPECIALTY_LABELS, CASE_STATUS_LABELS, CASE_STATUSES, PATIENT_SEX_LABELS } from "@ccr/types";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  FileUpIcon,
  ListPlusIcon,
  MoreHorizontalIcon,
  PresentationIcon,
  ScaleIcon,
  SparklesIcon,
  UserPlusIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { formatDate } from "@/lib/format";
import { generateHandoffAction, generateSummaryAction, generateTumorBoardAction } from "@/server/actions/briefs";
import { updateCaseStatusAction } from "@/server/actions/cases";
import { SyntheticPatientBadge } from "../shared/badges";
import { AvatarStack } from "../shared/user-avatar";
import { useCaseActions } from "./case-actions";
import { useCaseRealtime } from "./realtime-provider";

const STATUS_DOT: Record<CaseStatus, string> = {
  OPEN: "bg-sky-500",
  REVIEWING: "bg-indigo-500",
  DECISION_PENDING: "bg-amber-500",
  CLOSED: "bg-slate-400",
};

export interface CaseHeaderProps {
  title: string;
  status: CaseStatus;
  specialty: CaseSpecialty;
  patient: { name: string; age: number; sex: PatientSex; mrn: string; dateOfBirth: string; primaryDiagnosis: string };
}

export function useAIAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function run(label: string, action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string, href?: string) {
    startTransition(async () => {
      const toastId = toast.loading(label, { description: "Reading the full case record…" });
      const result = await action();
      if (!result.ok) {
        toast.error(result.error, { id: toastId, description: undefined });
        return;
      }
      toast.success(success, { id: toastId, description: "AI-generated draft. Review before relying on it." });
      if (href) router.push(href);
      else router.refresh();
    });
  }
  return { pending, run };
}

export function CaseHeader({ title, status, specialty, patient }: CaseHeaderProps) {
  const actions = useCaseActions();
  const realtime = useCaseRealtime();
  const router = useRouter();
  const ai = useAIAction();
  const [statusPending, startStatus] = useTransition();
  const { caseId, permissions } = actions;

  function changeStatus(next: CaseStatus) {
    startStatus(async () => {
      const result = await updateCaseStatusAction(caseId, next);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success(`Case status: ${CASE_STATUS_LABELS[next]}`);
        router.refresh();
      }
    });
  }

  return (
    <header className="border-b bg-card px-6 pt-4 lg:px-8">
      <nav className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
        <Link href="/cases" className="hover:text-foreground">
          Cases
        </Link>
        <ChevronRightIcon className="size-3" />
        <span className="truncate">{title}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight">{patient.name}</h1>
            <SyntheticPatientBadge />
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
            <span>
              {patient.age} y · {PATIENT_SEX_LABELS[patient.sex]}
            </span>
            <span className="text-border">|</span>
            <span>MRN {patient.mrn}</span>
            <span className="text-border">|</span>
            <span>DOB {formatDate(patient.dateOfBirth)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="font-medium text-foreground">{patient.primaryDiagnosis}</span>
            <span className="text-muted-foreground">· {CASE_SPECIALTY_LABELS[specialty]}</span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2.5">
          <div className="flex items-center gap-3">
            {permissions.manageCase ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    disabled={statusPending}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium shadow-xs hover:bg-accent disabled:opacity-60"
                  >
                    <span className={cn("size-2 rounded-full", STATUS_DOT[status])} />
                    {CASE_STATUS_LABELS[status]}
                    <ChevronDownIcon className="size-3 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Case status</DropdownMenuLabel>
                  {CASE_STATUSES.map((value) => (
                    <DropdownMenuItem key={value} onSelect={() => value !== status && changeStatus(value)}>
                      <span className={cn("size-2 rounded-full", STATUS_DOT[value])} />
                      {CASE_STATUS_LABELS[value]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium">
                <span className={cn("size-2 rounded-full", STATUS_DOT[status])} />
                {CASE_STATUS_LABELS[status]}
              </span>
            )}
            <button type="button" onClick={permissions.manageCase ? actions.openInvite : undefined} className="cursor-pointer" title="Care team">
              <AvatarStack users={actions.members} max={6} size="sm" onlineIds={realtime.onlineIds} />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {permissions.uploadDocument && (
              <Button variant="outline" size="sm" onClick={actions.openUpload}>
                <FileUpIcon />
                Upload document
              </Button>
            )}
            {permissions.manageCase && (
              <Button variant="outline" size="sm" onClick={actions.openInvite}>
                <UserPlusIcon />
                Invite specialist
              </Button>
            )}
            {permissions.generateBrief && (
              <Button
                variant="ai-outline"
                size="sm"
                disabled={ai.pending}
                onClick={() => ai.run("Generating case summary…", () => generateSummaryAction(caseId), "Case summary updated", `/cases/${caseId}`)}
              >
                <SparklesIcon />
                Generate summary
              </Button>
            )}
            {permissions.createDecision && (
              <Button size="sm" onClick={() => actions.openCreateDecision()}>
                <ScaleIcon />
                Create decision
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon-sm" aria-label="More actions">
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {permissions.generateBrief && (
                  <DropdownMenuItem
                    disabled={ai.pending}
                    onSelect={() =>
                      ai.run("Preparing tumor board brief…", () => generateTumorBoardAction(caseId), "Tumor board brief drafted", `/cases/${caseId}/tumor-board`)
                    }
                  >
                    <PresentationIcon />
                    Prepare tumor board
                  </DropdownMenuItem>
                )}
                {permissions.generateHandoff && (
                  <DropdownMenuItem
                    disabled={ai.pending}
                    onSelect={() => ai.run("Drafting patient handoff…", () => generateHandoffAction(caseId), "Handoff drafted", `/cases/${caseId}/handoff`)}
                  >
                    <ClipboardListIcon />
                    Generate handoff
                  </DropdownMenuItem>
                )}
                {permissions.manageTasks && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => actions.openCreateTask()}>
                      <ListPlusIcon />
                      Add task
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
}
