"use client";

import type { UserRole } from "@ccr/types";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { DocumentOption, UserSummary } from "@/lib/dto";
import { DecisionDialog, type DecisionPrefill } from "./dialogs/decision-dialog";
import { InviteDialog } from "./dialogs/invite-dialog";
import { TaskDialog, type TaskPrefill } from "./dialogs/task-dialog";
import { UploadDocumentDialog } from "./dialogs/upload-dialog";

export interface CasePermissions {
  manageCase: boolean;
  uploadDocument: boolean;
  editTimeline: boolean;
  postMessage: boolean;
  askAI: boolean;
  generateBrief: boolean;
  approveBrief: boolean;
  generateHandoff: boolean;
  approveHandoff: boolean;
  createDecision: boolean;
  reviewDecision: boolean;
  manageTasks: boolean;
}

export interface CaseClientData {
  caseId: string;
  caseTitle: string;
  patientName: string;
  currentUser: { id: string; name: string; role: UserRole };
  permissions: CasePermissions;
  members: UserSummary[];
  documents: DocumentOption[];
  organizationMembers: UserSummary[];
}

interface CaseActions extends CaseClientData {
  openUpload: () => void;
  openInvite: () => void;
  openCreateDecision: (prefill?: DecisionPrefill) => void;
  openCreateTask: (prefill?: TaskPrefill) => void;
}

const CaseActionsContext = createContext<CaseActions | null>(null);

export function CaseActionsProvider({ data, children }: { data: CaseClientData; children: ReactNode }) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [decision, setDecision] = useState<{ open: boolean; prefill?: DecisionPrefill; key: number }>({ open: false, key: 0 });
  const [task, setTask] = useState<{ open: boolean; prefill?: TaskPrefill; key: number }>({ open: false, key: 0 });

  const openUpload = useCallback(() => setUploadOpen(true), []);
  const openInvite = useCallback(() => setInviteOpen(true), []);
  const openCreateDecision = useCallback((prefill?: DecisionPrefill) => setDecision((d) => ({ open: true, prefill, key: d.key + 1 })), []);
  const openCreateTask = useCallback((prefill?: TaskPrefill) => setTask((t) => ({ open: true, prefill, key: t.key + 1 })), []);

  const value = useMemo<CaseActions>(
    () => ({ ...data, openUpload, openInvite, openCreateDecision, openCreateTask }),
    [data, openUpload, openInvite, openCreateDecision, openCreateTask],
  );

  return (
    <CaseActionsContext.Provider value={value}>
      {children}
      <UploadDocumentDialog caseId={data.caseId} open={uploadOpen} onOpenChange={setUploadOpen} />
      <InviteDialog
        caseId={data.caseId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        candidates={data.organizationMembers.filter((m) => !data.members.some((member) => member.id === m.id))}
      />
      <DecisionDialog
        key={`decision-${decision.key}`}
        mode="create"
        caseId={data.caseId}
        open={decision.open}
        onOpenChange={(open) => setDecision((d) => ({ ...d, open }))}
        prefill={decision.prefill}
        members={data.members}
        documents={data.documents}
        currentUserId={data.currentUser.id}
      />
      <TaskDialog
        key={`task-${task.key}`}
        caseId={data.caseId}
        open={task.open}
        onOpenChange={(open) => setTask((t) => ({ ...t, open }))}
        prefill={task.prefill}
        members={data.members}
      />
    </CaseActionsContext.Provider>
  );
}

export function useCaseActions(): CaseActions {
  const context = useContext(CaseActionsContext);
  if (!context) throw new Error("useCaseActions must be used inside CaseActionsProvider");
  return context;
}
