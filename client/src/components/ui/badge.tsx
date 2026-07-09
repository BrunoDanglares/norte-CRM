import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // Whitespace-nowrap: Badges should never wrap.
  "whitespace-nowrap inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        // Redesign Norte: flat azul sólido (estilo daisyUI badge-primary).
        default:
          "bg-primary text-primary-foreground border-transparent",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-destructive bg-[color:var(--danger-50,#FEF2F2)] text-destructive dark:bg-[color:rgba(220,38,38,0.15)]",
        outline: " border [border-color:var(--badge-outline)]",
        // ── Tags semânticas (alinhadas com mockup) ─────────────────────
        // Comercial / brand info — Azul Norte soft (redesign; nome mantido p/ compat)
        banana: "border-primary/30 bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary dark:border-primary/40",
        // Financeiro — warning amarelo intenso
        warning: "border-[color:var(--warning-500,#F59E0B)] bg-[color:var(--warning-50,#FFFBEB)] text-[color:#92400E] dark:bg-[rgba(245,158,11,0.15)] dark:text-[color:var(--warning-500,#F59E0B)]",
        // Resolvida / OK
        success: "border-[color:var(--success-500,#16A34A)] bg-[color:var(--success-50,#F0FDF4)] text-[color:var(--success-500,#16A34A)] dark:bg-[rgba(22,163,74,0.15)]",
        // Suporte / neutro
        neutral: "bg-secondary text-muted-foreground border-border",
        // FAQ / info azul
        tertiary: "border-[color:var(--tertiary-500,#2563EB)] bg-[color:var(--tertiary-50,#EFF6FF)] text-[color:var(--tertiary-500,#2563EB)] dark:bg-[rgba(37,99,235,0.15)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants }
