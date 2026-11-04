import { Skeleton } from "@/components/ui/skeleton";

/**
 * Instant feedback for route transitions inside the authenticated
 * app. Without this, first-visit navigations (dev compile, slow
 * networks) sit on the old page with no indication anything
 * happened — which reads as a dead click.
 */
export default function AppLoading() {
  return (
    <div role="status" aria-label="Loading page" className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
