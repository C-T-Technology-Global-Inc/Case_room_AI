"use client";

import { Button } from "@ccr/ui/components/button";
import { Spinner } from "@ccr/ui/components/misc";
import { ClipboardListIcon, PresentationIcon } from "lucide-react";
import { generateHandoffAction, generateTumorBoardAction } from "@/server/actions/briefs";
import { useAIAction } from "../case/case-header";

export function GenerateBriefButton({ caseId, type, label, variant = "ai" }: { caseId: string; type: "TUMOR_BOARD" | "HANDOFF"; label: string; variant?: "ai" | "ai-outline" }) {
  const ai = useAIAction();
  const Icon = type === "TUMOR_BOARD" ? PresentationIcon : ClipboardListIcon;
  return (
    <Button
      variant={variant}
      size="sm"
      disabled={ai.pending}
      onClick={() =>
        type === "TUMOR_BOARD"
          ? ai.run("Preparing tumor board brief…", () => generateTumorBoardAction(caseId), "Tumor board brief drafted")
          : ai.run("Drafting patient handoff…", () => generateHandoffAction(caseId), "Handoff drafted")
      }
    >
      {ai.pending ? <Spinner /> : <Icon />}
      {label}
    </Button>
  );
}
