import { CASE_SPECIALTY_LABELS, PATIENT_SEX_LABELS, type CaseSpecialty, type CaseStatus, type PatientSex } from "@ccr/types";
import { CheckSquareIcon, FileTextIcon, ScaleIcon } from "lucide-react";
import Link from "next/link";
import { ageFromDob } from "@/lib/format";
import { CaseStatusBadge, SyntheticPatientBadge } from "../shared/badges";
import { TimeAgo } from "../shared/misc";
import { AvatarStack } from "../shared/user-avatar";

export interface CaseCardData {
  id: string;
  title: string;
  status: CaseStatus;
  specialty: CaseSpecialty;
  updatedAt: Date;
  patient: { firstName: string; lastName: string; dateOfBirth: Date; sex: PatientSex; primaryDiagnosis: string; syntheticMedicalRecordNumber: string };
  members: Array<{ user: { id: string; name: string } }>;
  _count: { documents: number; tasks: number; decisions: number };
}

export function CaseCard({ room }: { room: CaseCardData }) {
  const { patient } = room;
  return (
    <Link
      href={`/cases/${room.id}`}
      className="group flex flex-col rounded-xl border bg-card p-4 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all hover:-translate-y-px hover:border-primary/30 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold tracking-tight group-hover:text-primary">
              {patient.firstName} {patient.lastName}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {ageFromDob(patient.dateOfBirth)}y · {PATIENT_SEX_LABELS[patient.sex]} · {patient.syntheticMedicalRecordNumber}
          </div>
        </div>
        <CaseStatusBadge status={room.status} />
      </div>

      <div className="mt-3 line-clamp-2 text-[13px] font-medium text-foreground/90">{patient.primaryDiagnosis}</div>
      <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
        {room.title} · {CASE_SPECIALTY_LABELS[room.specialty]}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3">
        <AvatarStack users={room.members.map((m) => m.user)} max={5} size="sm" />
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1" title="Documents">
            <FileTextIcon className="size-3.5" />
            {room._count.documents}
          </span>
          <span className="inline-flex items-center gap-1" title="Open tasks">
            <CheckSquareIcon className="size-3.5" />
            {room._count.tasks}
          </span>
          {room._count.decisions > 0 && (
            <span className="inline-flex items-center gap-1 font-medium text-amber-700" title="Decisions awaiting approval">
              <ScaleIcon className="size-3.5" />
              {room._count.decisions}
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <SyntheticPatientBadge compact className="scale-95" />
        <span>
          Updated <TimeAgo date={room.updatedAt} />
        </span>
      </div>
    </Link>
  );
}
