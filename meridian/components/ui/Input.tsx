import { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-9 w-full rounded-md border border-border-strong bg-panel-alt px-3 text-[13px] text-ink-primary placeholder:text-ink-muted",
      "outline-none focus:border-clinical/60 transition-colors duration-150",
      className
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full rounded-md border border-border-strong bg-panel-alt px-3 py-2.5 text-[13px] leading-relaxed text-ink-primary placeholder:text-ink-muted",
      "outline-none focus:border-clinical/60 transition-colors duration-150 resize-none",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-9 w-full rounded-md border border-border-strong bg-panel-alt px-3 text-[13px] text-ink-primary",
      "outline-none focus:border-clinical/60 transition-colors duration-150 appearance-none bg-no-repeat",
      className
    )}
    style={{
      backgroundImage:
        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%239AA7B5' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
      backgroundPosition: "right 12px center",
      paddingRight: "32px",
    }}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";
