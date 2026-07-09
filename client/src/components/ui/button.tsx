import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Redesign Norte: font-medium (igual ao `.btn` do ERP daisyUI, não semibold).
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 transition-all duration-150 active:scale-[0.97]" +
  " hover-elevate active-elevate-2",
  {
    variants: {
      variant: {
        // Bruno 2026-05-21: era banana gradient hardcoded (var(--banana-*));
        // virou tema-aware via `gradient-accent` (que usa --primary com
        // color-mix). Agora o CTA acompanha banana/lilac/blue/orange. Texto
        // vem de --primary-foreground (preto pra banana/laranja, branco pra
        // lilás/azul) com !important dentro de gradient-accent.
        // Bruno 2026-07-04: CTA volta a ter GRADIENTE (violeta→rosa) + glow, via
        // a utilitária .gradient-accent (bg/cor/borda/hover/glow centralizados no
        // index.css). Antes: flat bg-primary chapado do redesign Nexus.
        default:
          "gradient-accent",
        destructive:
          "bg-destructive text-destructive-foreground border border-destructive-border",
        outline:
          // Shows the background color of whatever card / sidebar / accent background it is inside of.
          // Inherits the current text color.
          " border [border-color:var(--button-outline)]  shadow-xs active:shadow-none ",
        secondary: "border bg-secondary text-secondary-foreground border border-secondary-border ",
        // Tertiary — azul, ações de link/informação. NÃO usar pra CTA principal.
        tertiary:
          "bg-tertiary-500 text-white border border-tertiary-600 hover:bg-tertiary-600",
        // Add a transparent border so that when someone toggles a border on later, it doesn't shift layout/size.
        ghost: "border border-transparent",
      },
      // Heights are set as "min" heights, because sometimes Ai will place large amount of content
      // inside buttons. With a min-height they will look appropriate with small amounts of content,
      // but will expand to fit large amounts of content.
      size: {
        default: "min-h-9 px-4 py-2",
        sm: "min-h-8 rounded-md px-3 text-xs",
        lg: "min-h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
