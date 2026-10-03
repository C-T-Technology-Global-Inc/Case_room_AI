import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-px text-[11px] font-medium leading-[18px] [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/10 text-primary",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border bg-card text-foreground",
        muted: "border-transparent bg-muted text-muted-foreground",
        ai: "border-ai-border bg-ai-soft text-ai",
        approved: "border-approved-border bg-approved-soft text-approved",
        draft: "border-draft-border bg-draft-soft text-draft",
        source: "border-source-border bg-source-soft text-source",
        danger: "border-danger-border bg-danger-soft text-danger",
        solid: "border-transparent bg-foreground text-background",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
