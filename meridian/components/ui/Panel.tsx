import { cn } from "@/lib/utils";
import { HTMLAttributes } from "react";

export function Panel({
  className,
  interactive = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-panel shadow-clinic dark:shadow-panel",
        interactive &&
          "transition-colors duration-150 hover:border-border-strong hover:bg-panel-hover cursor-pointer",
        className
      )}
      {...props}
    />
  );
}

export function PanelHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center justify-between gap-3 border-b border-border px-5 py-4", className)} {...props} />;
}

export function PanelBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}
