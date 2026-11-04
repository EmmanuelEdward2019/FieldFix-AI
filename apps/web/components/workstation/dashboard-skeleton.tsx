import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Loading placeholder mirroring the workstation grid. */
export function DashboardSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading demo workstation"
      className="mx-auto flex w-full max-w-[100rem] flex-col gap-4 p-4 sm:p-6"
    >
      <span className="sr-only">Loading demo workstation…</span>
      <Skeleton className="h-28 w-full" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_360px]">
        <Skeleton className="hidden h-96 lg:block" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
        <div className="flex flex-col gap-4 lg:col-span-2 xl:col-span-1">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
      <Card aria-hidden>
        <CardHeader>
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
