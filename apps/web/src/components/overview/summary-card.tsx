import { Badge } from "@ccr/ui/components/badge";
import { cn } from "@ccr/ui/lib/utils";
import type { CaseSummaryContent } from "@ccr/types";
import { AlertCircleIcon, HelpCircleIcon, InfoIcon, SearchXIcon } from "lucide-react";
import { formatDate } from "@/lib/format";
import { AIGeneratedBadge, DraftBadge, HumanApprovedBadge } from "../shared/badges";
import { TimeAgo } from "../shared/misc";
import { SourceChip } from "../shared/sources";
import { GenerateSummaryButton, MarkReviewedButton } from "./summary-actions";

export interface SummaryCardProps {
  caseId: string;
  briefId: string;
  version: number;
  summary: CaseSummaryContent;
  status: "DRAFT" | "APPROVED";
  createdAt: Date;
  requestedBy: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  provider: string | null;
  model: string | null;
  canGenerate: boolean;
  canApprove: boolean;
}

const FLAG_STYLE = {
  normal: "text-foreground",
  abnormal: "font-semibold text-orange-700",
  critical: "font-semibold text-red-700",
  unknown: "text-foreground",
} as const;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{children}</h3>;
}

export function SummaryCard(props: SummaryCardProps) {
  const { summary, caseId } = props;
  return (
    <article className="overflow-hidden rounded-xl border border-ai-border bg-card shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ai-border/60 bg-ai-soft/50 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Case summary</h2>
          <AIGeneratedBadge />
          {props.status === "APPROVED" ? <HumanApprovedBadge label={`Reviewed by ${props.approvedBy ?? "clinician"}`} /> : <DraftBadge />}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-muted-foreground">
            <TimeAgo date={props.createdAt} />
            {props.requestedBy ? ` · requested by ${props.requestedBy}` : ""}
          </span>
          {props.canApprove && props.status === "DRAFT" && <MarkReviewedButton caseId={caseId} briefId={props.briefId} version={props.version} />}
          {props.canGenerate && <GenerateSummaryButton caseId={caseId} label="Regenerate" variant="ai-outline" />}
        </div>
      </header>

      <div className="space-y-6 px-5 py-5">
        <div className="space-y-2">
          <p className="text-lg leading-snug font-semibold tracking-tight text-balance">{summary.headline}</p>
          <p className="text-[13.5px] leading-relaxed text-foreground/85">{summary.currentStatus}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border bg-background/60 p-3.5">
            <SectionTitle>Current diagnosis</SectionTitle>
            <p className="text-[13px] leading-relaxed">{summary.currentDiagnosis}</p>
          </div>
          <div className="rounded-lg border bg-background/60 p-3.5">
            <SectionTitle>Current treatment</SectionTitle>
            <p className="text-[13px] leading-relaxed">{summary.currentTreatment}</p>
          </div>
        </div>

        {summary.keyFindings.length > 0 && (
          <section>
            <SectionTitle>Key findings</SectionTitle>
            <ul className="space-y-2.5">
              {summary.keyFindings.map((finding, index) => (
                <li key={index} className="flex gap-3">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-ai/60" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-[13.5px] leading-relaxed">{finding.text}</p>
                    {finding.sources.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {finding.sources.map((source) => (
                          <SourceChip key={source.id} caseId={caseId} source={source} />
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {summary.latestResults.length > 0 && (
          <section>
            <SectionTitle>Latest important results</SectionTitle>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-[13px]">
                <tbody className="divide-y">
                  {summary.latestResults.map((result, index) => (
                    <tr key={index} className="align-top">
                      <td className="w-40 px-3 py-2 text-muted-foreground">{result.label}</td>
                      <td className={cn("px-3 py-2", FLAG_STYLE[result.flag])}>
                        {result.value}
                        {result.flag === "critical" && <AlertCircleIcon className="ml-1 inline size-3.5" />}
                      </td>
                      <td className="w-24 px-3 py-2 text-right text-xs whitespace-nowrap text-muted-foreground">{result.date ? formatDate(result.date, { year: false }) : ""}</td>
                      <td className="w-28 px-3 py-1.5 text-right">
                        {result.sources[0] && <SourceChip caseId={caseId} source={result.sources[0]} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {summary.outstandingQuestions.length > 0 && (
            <section className="rounded-lg border bg-background/60 p-3.5">
              <SectionTitle>Outstanding questions</SectionTitle>
              <ul className="space-y-1.5">
                {summary.outstandingQuestions.map((question, index) => (
                  <li key={index} className="flex gap-2 text-[13px] leading-snug">
                    <HelpCircleIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    {question}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {summary.missingInformation.length > 0 && (
            <section className="rounded-lg border border-draft-border bg-draft-soft/50 p-3.5">
              <SectionTitle>Missing information</SectionTitle>
              <ul className="space-y-2">
                {summary.missingInformation.map((item, index) => (
                  <li key={index} className="flex gap-2 text-[13px] leading-snug">
                    <SearchXIcon className="mt-0.5 size-3.5 shrink-0 text-draft" />
                    <span>
                      <span className="font-medium">{item.item}</span>{" "}
                      <Badge variant={item.priority === "high" ? "danger" : "muted"} className="ml-1 align-middle">
                        {item.priority}
                      </Badge>
                      <span className="block text-xs text-muted-foreground">{item.reason}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <footer className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <span className="font-medium text-foreground/80">Limitations:</span> {summary.limitations}
            {props.provider && (
              <span className="block pt-0.5">
                Generated by {props.provider}
                {props.model ? ` (${props.model})` : ""}. AI-generated content must be reviewed by a qualified healthcare professional.
              </span>
            )}
          </span>
        </footer>
      </div>
    </article>
  );
}
