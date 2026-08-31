import { LucideIcon, TriangleAlert } from "lucide-react";
import { ReactNode } from "react";
import { Button } from "./Button";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong bg-panel/40 px-6 py-16 text-center">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-[rgb(var(--overlay-hover)/0.05)] text-ink-muted">
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <h3 className="text-[15px] font-semibold text-ink-primary">{title}</h3>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-secondary">{description}</p>
      {action && (
        <Button variant="primary" size="sm" className="mt-5" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
}: {
  title?: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-critical/25 bg-critical-dim px-6 py-14 text-center">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-critical/15 text-critical">
        <TriangleAlert className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <h3 className="text-[15px] font-semibold text-ink-primary">{title}</h3>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-secondary">{description}</p>
      {action && (
        <Button variant="outline" size="sm" className="mt-5" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

export function ReducedMotionNotice({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
