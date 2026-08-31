import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-md", className)} />;
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-panel p-5">
      <Skeleton className="h-3 w-24 mb-4" />
      <Skeleton className="h-8 w-16 mb-3" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

export function TableRowSkeleton() {
  return (
    <div className="flex items-center gap-4 border-b border-border px-5 py-3.5">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-4 w-14" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-4 w-16 ml-auto" />
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-panel overflow-hidden">
      <Skeleton className="h-32 w-full rounded-none" />
      <div className="p-4 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}
