"use client";

import { Button } from "@ccr/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ccr/ui/components/dialog";
import { Input } from "@ccr/ui/components/input";
import { Label } from "@ccr/ui/components/label";
import { Spinner } from "@ccr/ui/components/misc";
import { NativeSelect } from "@ccr/ui/components/native-select";
import { Textarea } from "@ccr/ui/components/textarea";
import { TIMELINE_EVENT_TYPE_LABELS, TIMELINE_EVENT_TYPES, type TimelineEventType } from "@ccr/types";
import { PlusIcon, RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addTimelineEventAction, regenerateTimelineAction } from "@/server/actions/cases";
import { useCaseActions } from "../case/case-actions";

export function TimelineActions({ caseId }: { caseId: string }) {
  const { documents, permissions } = useCaseActions();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [eventType, setEventType] = useState<TimelineEventType>("NOTE");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sourceDocumentId, setSourceDocumentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [regenerating, startRegenerate] = useTransition();

  if (!permissions.editTimeline) return null;

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await addTimelineEventAction(caseId, { date, eventType, title, description, sourceDocumentId: sourceDocumentId || null });
      if (!result.ok) return setError(result.error);
      toast.success("Timeline event added");
      setOpen(false);
      setTitle("");
      setDescription("");
      router.refresh();
    });
  }

  function regenerate() {
    startRegenerate(async () => {
      const id = toast.loading("AI is rebuilding the timeline from all documents…");
      const result = await regenerateTimelineAction(caseId);
      if (!result.ok) toast.error(result.error, { id });
      else {
        toast.success(`Timeline regenerated: ${result.data.events} AI events`, { id, description: "Events added by clinicians were kept." });
        router.refresh();
      }
    });
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button variant="ai-outline" size="sm" onClick={regenerate} disabled={regenerating}>
        {regenerating ? <Spinner /> : <RefreshCwIcon />}
        Regenerate from documents
      </Button>
      <Button size="sm" onClick={() => setOpen(true)}>
        <PlusIcon />
        Add event
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add timeline event</DialogTitle>
            <DialogDescription>Clinician-entered events are labeled with your name and kept when the AI regenerates the timeline.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="event-date">Date</Label>
                <Input id="event-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="event-type">Type</Label>
                <NativeSelect id="event-type" value={eventType} onChange={(e) => setEventType(e.target.value as TimelineEventType)}>
                  {TIMELINE_EVENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {TIMELINE_EVENT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="event-title">Title</Label>
              <Input id="event-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Port placed" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="event-description">Description</Label>
              <Textarea id="event-description" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="event-source">Source document (optional)</Label>
              <NativeSelect id="event-source" value={sourceDocumentId} onChange={(e) => setSourceDocumentId(e.target.value)}>
                <option value="">None</option>
                {documents.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.title}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {error && <p className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending && <Spinner />}
              Add event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
