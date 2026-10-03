import { cn } from "@ccr/ui/lib/utils";

/** Product mark: a case (rounded square) with a clinical cross and a second "participant" dot. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="8" className="fill-primary" />
      <path d="M13 9h4v5h5v4h-5v5h-4v-5H8v-4h5z" fill="white" />
      <circle cx="24.5" cy="24.5" r="3.5" fill="white" />
      <circle cx="24.5" cy="24.5" r="1.8" className="fill-ai" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <div className="leading-tight">
        <div className="text-[13px] font-semibold tracking-tight">Clinical Case Room</div>
        <div className="text-[11px] text-muted-foreground">Multiplayer AI for clinical teams</div>
      </div>
    </div>
  );
}
