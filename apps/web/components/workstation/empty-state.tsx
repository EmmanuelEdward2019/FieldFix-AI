import type { LucideIcon } from "lucide-react";
import { DeviceScene } from "@/components/fx/device-scene";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  hint: string;
  className?: string;
  /** Device kind for an illustrated backdrop (evidence canvas only). */
  scene?: string;
}

/** Shared empty state for panels with no demo content. */
export function EmptyState({ icon: Icon, title, hint, className, scene }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border border-dashed border-edge-strong px-4 py-8 text-center",
        className,
      )}
    >
      {scene != null ? (
        <DeviceScene device={scene} scanning={false} className="w-full max-w-55" />
      ) : (
        <span className="flex size-10 items-center justify-center rounded-full bg-panel-elevated">
          <Icon className="size-5 text-slate-400" aria-hidden />
        </span>
      )}
      <p className="text-sm font-medium text-slate-200">{title}</p>
      <p className="max-w-xs text-xs text-slate-400">{hint}</p>
    </div>
  );
}
