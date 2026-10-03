import { Avatar, AvatarFallback } from "@ccr/ui/components/avatar";
import { cn } from "@ccr/ui/lib/utils";
import { SparklesIcon } from "lucide-react";
import { initials } from "@/lib/format";

const PALETTE = [
  "bg-sky-100 text-sky-800",
  "bg-emerald-100 text-emerald-800",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-800",
  "bg-indigo-100 text-indigo-800",
  "bg-teal-100 text-teal-800",
  "bg-orange-100 text-orange-800",
  "bg-cyan-100 text-cyan-800",
  "bg-lime-100 text-lime-800",
  "bg-fuchsia-100 text-fuchsia-800",
];

function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
}

const SIZES = {
  xs: "size-5 text-[9px]",
  sm: "size-6 text-[10px]",
  md: "size-8 text-[11px]",
  lg: "size-10 text-sm",
} as const;

export function UserAvatar({
  user,
  size = "md",
  online,
  className,
}: {
  user: { id: string; name: string };
  size?: keyof typeof SIZES;
  online?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)} title={user.name}>
      <Avatar className={cn(SIZES[size])}>
        <AvatarFallback className={cn(colorFor(user.id), SIZES[size])}>{initials(user.name)}</AvatarFallback>
      </Avatar>
      {online !== undefined && (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-card",
            online ? "bg-emerald-500" : "bg-slate-300",
          )}
          aria-label={online ? "online" : "offline"}
        />
      )}
    </span>
  );
}

export function AIAvatar({ size = "md", className }: { size?: keyof typeof SIZES; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-ai text-white shadow-sm",
        SIZES[size],
        className,
      )}
      title="AI case assistant"
    >
      <SparklesIcon className={size === "lg" ? "size-5" : size === "md" ? "size-4" : "size-3"} />
    </span>
  );
}

export function AvatarStack({
  users,
  max = 5,
  size = "sm",
  onlineIds,
}: {
  users: Array<{ id: string; name: string }>;
  max?: number;
  size?: keyof typeof SIZES;
  onlineIds?: Set<string>;
}) {
  const visible = users.slice(0, max);
  const rest = users.length - visible.length;
  return (
    <div className="flex items-center -space-x-1">
      {visible.map((user, index) => (
        <span key={user.id} className="relative inline-flex" style={{ zIndex: visible.length - index }}>
          <UserAvatar user={user} size={size} online={onlineIds ? onlineIds.has(user.id) : undefined} className="rounded-full ring-2 ring-card" />
        </span>
      ))}
      {rest > 0 && (
        <span className={cn("relative z-0 inline-flex items-center justify-center rounded-full bg-muted font-medium text-muted-foreground ring-2 ring-card", SIZES[size])}>
          +{rest}
        </span>
      )}
    </div>
  );
}
