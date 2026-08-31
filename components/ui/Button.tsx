"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "critical" | "success";
type Size = "sm" | "md" | "lg" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary: "bg-clinical text-canvas hover:bg-clinical-strong shadow-[0_1px_0_0_rgba(255,255,255,0.25)_inset]",
  secondary: "bg-panel-hover text-ink-primary hover:bg-clinical/10 hover:border-clinical/30 border border-border-strong",
  ghost: "bg-transparent text-ink-secondary hover:text-ink-primary hover:bg-[rgb(var(--overlay-hover)/0.06)]",
  outline: "bg-transparent border border-border-strong text-ink-primary hover:bg-[rgb(var(--overlay-hover)/0.04)]",
  critical: "bg-critical text-canvas hover:bg-critical-strong",
  success: "bg-success text-canvas hover:bg-success-strong",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-md",
  md: "h-9 px-4 text-[13px] gap-2 rounded-md",
  lg: "h-11 px-5 text-sm gap-2 rounded-lg",
  icon: "h-9 w-9 rounded-md",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors duration-150",
          "disabled:opacity-40 disabled:cursor-not-allowed select-none",
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
