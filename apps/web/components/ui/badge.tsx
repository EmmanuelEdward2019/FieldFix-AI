import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide whitespace-nowrap uppercase",
  {
    variants: {
      variant: {
        default: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200",
        secondary: "border-edge-strong bg-panel-elevated text-slate-300",
        outline: "border-edge-strong text-slate-300",
        success: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
        warning: "border-amber-400/30 bg-amber-400/10 text-amber-200",
        danger: "border-red-400/40 bg-red-400/10 text-red-200",
        muted: "border-edge bg-panel text-slate-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
