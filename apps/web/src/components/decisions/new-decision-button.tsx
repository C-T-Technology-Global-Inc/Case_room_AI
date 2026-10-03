"use client";

import { Button } from "@ccr/ui/components/button";
import { ScaleIcon } from "lucide-react";
import { useCaseActions } from "../case/case-actions";

export function NewDecisionButton() {
  const { openCreateDecision, permissions } = useCaseActions();
  if (!permissions.createDecision) return null;
  return (
    <Button size="sm" onClick={() => openCreateDecision()}>
      <ScaleIcon />
      Create decision
    </Button>
  );
}
