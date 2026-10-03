"use client";

import { Button } from "@ccr/ui/components/button";
import { Spinner } from "@ccr/ui/components/misc";
import { CheckIcon, RefreshCwIcon, SparklesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { approveBriefAction, generateSummaryAction } from "@/server/actions/briefs";
import { useAIAction } from "../case/case-header";

export function GenerateSummaryButton({ caseId, label = "Generate summary", variant = "ai" }: { caseId: string; label?: string; variant?: "ai" | "ai-outline" }) {
  const ai = useAIAction();
  return (
    <Button
      variant={variant}
      size="sm"
      disabled={ai.pending}
      onClick={() => ai.run("Generating case summary…", () => generateSummaryAction(caseId), "Case summary updated")}
    >
      {ai.pending ? <Spinner /> : label.startsWith("Re") ? <RefreshCwIcon /> : <SparklesIcon />}
      {label}
    </Button>
  );
}

export function MarkReviewedButton({
  caseId,
  briefId,
  version,
  label = "Mark as reviewed",
}: {
  caseId: string;
  briefId: string;
  /** The summary version on screen; marking reviewed applies only to it. */
  version: number;
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="approve"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await approveBriefAction(caseId, briefId, { expectedVersion: version });
          if (!result.ok) {
            toast.error(result.error);
            router.refresh();
          } else {
            toast.success("Marked as reviewed by you");
            router.refresh();
          }
        })
      }
    >
      {pending ? <Spinner /> : <CheckIcon />}
      {label}
    </Button>
  );
}
