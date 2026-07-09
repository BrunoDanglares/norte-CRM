import * as React from "react"
import { cn } from "@/lib/utils"

type InputProps = React.ComponentProps<"input"> & {
  label?: string;
  rightElement?: React.ReactNode;
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, rightElement, onFocus, onBlur, value, defaultValue, ...props }, ref) => {
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
        <input
          type={type}
          className={cn(
            "flex h-9 w-full rounded-md border border-base-300 bg-base-100 px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground transition-all duration-150 hover:border-foreground/30 focus-visible:outline-none focus-visible:border-primary focus-visible:[box-shadow:0_0_0_3px_hsl(var(--primary)/0.18)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
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
        <input
          type={type}
          className={cn(
            "flex h-14 w-full rounded-md border border-base-300 bg-base-100 px-3 pt-6 pb-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground transition-all duration-150 hover:border-foreground/30 focus-visible:outline-none focus-visible:border-primary focus-visible:[box-shadow:0_0_0_3px_hsl(var(--primary)/0.18)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm placeholder-transparent",
            rightElement && "pr-10",
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
              : "top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
          )}
        >
          {label}
        </label>
        {rightElement && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {rightElement}
          </div>
        )}
      </div>
    );
  }
);
Input.displayName = "Input"

export { Input }
