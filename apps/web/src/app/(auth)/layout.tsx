import { FileSearchIcon, ShieldCheckIcon, SparklesIcon, UsersIcon } from "lucide-react";
import { LogoMark } from "@/components/layout/logo";

const PRINCIPLES = [
  { icon: UsersIcon, title: "Multiplayer by design", text: "Oncologists, surgeons, radiologists, pathologists and nurses work in one shared patient case." },
  { icon: SparklesIcon, title: "AI for the whole team", text: "One assistant with the full authorized case context, answering anyone on the care team." },
  { icon: FileSearchIcon, title: "Evidence first", text: "Every AI statement links back to the source record. Unverifiable citations are dropped." },
  { icon: ShieldCheckIcon, title: "Humans decide", text: "AI proposes. Clinical decisions become final only after human review and approval." },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="relative hidden overflow-hidden bg-slate-950 text-slate-100 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(60rem 30rem at 10% -10%, rgba(59,130,246,0.25), transparent 60%), radial-gradient(40rem 30rem at 110% 110%, rgba(139,92,246,0.22), transparent 60%)",
          }}
        />
        <div className="relative flex items-center gap-3">
          <LogoMark className="size-9" />
          <div>
            <div className="text-base font-semibold tracking-tight">Clinical Case Room</div>
            <div className="text-xs text-slate-400">Multiplayer AI for clinical teams</div>
          </div>
        </div>

        <div className="relative max-w-lg space-y-8">
          <div className="space-y-3">
            <h1 className="text-3xl leading-tight font-semibold tracking-tight text-balance">
              One patient. One shared case. The whole care team and an AI that works for all of them.
            </h1>
            <p className="text-[15px] leading-relaxed text-slate-400">
              Shared patient memory, evidence-grounded answers, tumor board preparation and human-approved decisions, in one
              collaborative workspace.
            </p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {PRINCIPLES.map((principle) => (
              <li key={principle.title} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <principle.icon className="mb-2 size-4 text-sky-300" />
                <div className="text-sm font-medium">{principle.title}</div>
                <div className="mt-1 text-xs leading-relaxed text-slate-400">{principle.text}</div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative text-xs text-slate-500">
          Demo environment. All patients are synthetic. Not a medical device; AI output must be reviewed by a qualified healthcare professional.
        </div>
      </aside>
      <main className="flex items-center justify-center bg-background px-6 py-12">{children}</main>
    </div>
  );
}
