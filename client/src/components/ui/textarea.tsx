import * as React from "react"
import { cn } from "@/lib/utils"

type TextareaProps = React.ComponentProps<"textarea"> & {
  label?: string;
};

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, onFocus, onBlur, value, defaultValue, ...props }, ref) => {
    const [isFocused, setIsFocused] = React.useState(false);

    const hasValue =
      value !== undefined
        ? String(value).length > 0
        : defaultValue !== undefined
        ? String(defaultValue).length > 0
        : false;

    const isFloated = isFocused || hasValue;

    if (!label) {
      return (
        <textarea
          className={cn(
            "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            className
          )}
          value={value}
          defaultValue={defaultValue}
          onFocus={onFocus}
          onBlur={onBlur}
          ref={ref}
          {...props}
        />
      );
    }

    return (
      <div className="relative">
        <textarea
          className={cn(
            "flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 pt-7 pb-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm placeholder-transparent resize-none",
            className
          )}
          placeholder=" "
          value={value}
          defaultValue={defaultValue}
          onFocus={(e) => {
            setIsFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            onBlur?.(e);
          }}
          ref={ref}
          {...props}
        />
        <label
          className={cn(
            "absolute left-3 pointer-events-none select-none transition-all duration-200 leading-none",
            isFloated
              ? "top-2 text-[10px] font-semibold text-primary"
              : "top-4 text-sm text-muted-foreground"
          )}
        >
          {label}
        </label>
      </div>
    );
  }
);
Textarea.displayName = "Textarea"

export { Textarea }
