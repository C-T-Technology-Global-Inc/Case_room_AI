import { cn } from "@ccr/ui/lib/utils";
import type { TimelineEventType } from "@ccr/types";
import {
  BedDoubleIcon,
  CircleIcon,
  DoorOpenIcon,
  MicroscopeIcon,
  NotebookPenIcon,
  PillIcon,
  ScaleIcon,
  ScanIcon,
  StethoscopeIcon,
  SyringeIcon,
  TestTubeIcon,
} from "lucide-react";

const CONFIG: Record<TimelineEventType, { icon: typeof CircleIcon; className: string }> = {
  IMAGING: { icon: ScanIcon, className: "bg-sky-50 text-sky-700 ring-sky-200" },
  LAB: { icon: TestTubeIcon, className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  PROCEDURE: { icon: SyringeIcon, className: "bg-orange-50 text-orange-700 ring-orange-200" },
  PATHOLOGY: { icon: MicroscopeIcon, className: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200" },
  CONSULTATION: { icon: StethoscopeIcon, className: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  ADMISSION: { icon: BedDoubleIcon, className: "bg-red-50 text-red-700 ring-red-200" },
  TREATMENT: { icon: PillIcon, className: "bg-teal-50 text-teal-700 ring-teal-200" },
  DECISION: { icon: ScaleIcon, className: "bg-amber-50 text-amber-800 ring-amber-200" },
  NOTE: { icon: NotebookPenIcon, className: "bg-slate-100 text-slate-700 ring-slate-200" },
  DISCHARGE: { icon: DoorOpenIcon, className: "bg-lime-50 text-lime-800 ring-lime-200" },
  OTHER: { icon: CircleIcon, className: "bg-slate-100 text-slate-600 ring-slate-200" },
};

export function TimelineEventIcon({ type, className }: { type: TimelineEventType; className?: string }) {
  const { icon: Icon, className: tone } = CONFIG[type];
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full ring-1", tone, className)}>
      <Icon className="size-4" />
    </span>
  );
}
