"use client";

import { Button } from "@ccr/ui/components/button";
import { FileUpIcon } from "lucide-react";
import { useCaseActions } from "../case/case-actions";

export function UploadButton({ label = "Upload document" }: { label?: string }) {
  const { openUpload, permissions } = useCaseActions();
  if (!permissions.uploadDocument) return null;
  return (
    <Button size="sm" onClick={openUpload}>
      <FileUpIcon />
      {label}
    </Button>
  );
}
