import { Skeleton } from "@/components/ui/skeleton";

/**
 * Instant feedback for console route transitions. Mirrors the
 * (app) loading state so admin navigation never looks stalled.
 */
export default function AdminLoading() {
  return (
    <div role="status" aria-label="Loading page" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
