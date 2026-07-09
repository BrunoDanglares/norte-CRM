import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      // Redesign Norte: escala de cantos IDÊNTICA ao ERP (daisyui.css remapeia
      // --radius-xs..4xl → box/field). No ERP tudo é 0.5rem (selector/field) ou
      // 0.75rem (box) — sem 1rem/1.5rem soltos. Replicamos aqui pra @config: assim
      // rounded-sm..md = 0.5 (field) e rounded-lg..3xl = 0.75 (box), fiel ao ERP.
      borderRadius: {
        sm: "0.5rem",   /* selector/field — igual ao ERP */
        md: "0.5rem",   /* field (botões/inputs) */
        lg: "0.75rem",  /* box/card */
        xl: "0.75rem",  /* box (era 0.75 default, mantido) */
        "2xl": "0.75rem", /* box (era 1rem — alinhado ao ERP) */
        "3xl": "0.75rem", /* box (era 1.5rem — alinhado ao ERP) */
      },
      colors: {
        // Flat / base colors (regular buttons)
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
          border: "hsl(var(--card-border) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
          border: "hsl(var(--popover-border) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          border: "var(--primary-border)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
          border: "var(--secondary-border)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
          border: "var(--muted-border)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
          border: "var(--accent-border)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
          border: "var(--destructive-border)",
        },
        brand: {
          DEFAULT: "hsl(var(--brand) / <alpha-value>)",
          foreground: "hsl(var(--brand-foreground) / <alpha-value>)",
          soft: "hsl(var(--brand-soft) / <alpha-value>)",
        },
        ring: "hsl(var(--ring) / <alpha-value>)",
        chart: {
          "1": "hsl(var(--chart-1) / <alpha-value>)",
          "2": "hsl(var(--chart-2) / <alpha-value>)",
          "3": "hsl(var(--chart-3) / <alpha-value>)",
          "4": "hsl(var(--chart-4) / <alpha-value>)",
          "5": "hsl(var(--chart-5) / <alpha-value>)",
        },
        sidebar: {
          ring: "hsl(var(--sidebar-ring) / <alpha-value>)",
          DEFAULT: "hsl(var(--sidebar) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-foreground) / <alpha-value>)",
          border: "hsl(var(--sidebar-border) / <alpha-value>)",
        },
        "sidebar-primary": {
          DEFAULT: "hsl(var(--sidebar-primary) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-primary-foreground) / <alpha-value>)",
          border: "var(--sidebar-primary-border)",
        },
        "sidebar-accent": {
          DEFAULT: "hsl(var(--sidebar-accent) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-accent-foreground) / <alpha-value>)",
          border: "var(--sidebar-accent-border)"
        },
        status: {
          online: "rgb(34 197 94)",
          away: "rgb(245 158 11)",
          busy: "rgb(239 68 68)",
          offline: "rgb(156 163 175)",
        },
        // ── Paleta BANANA (escala mesclada soft → intenso) ────────────────
        // Usar via: bg-banana-400, text-banana-700, border-banana-500, etc.
        banana: {
          50:  "var(--banana-50)",
          100: "var(--banana-100)",
          200: "var(--banana-200)",
          300: "var(--banana-300)",
          400: "var(--banana-400)",
          500: "var(--banana-500)",
          600: "var(--banana-600)",
          700: "var(--banana-700)",
          800: "var(--banana-800)",
          900: "var(--banana-900)",
        },
        // ── Tertiary (azul) — apenas links/info, NUNCA em CTA ─────────────
        tertiary: {
          DEFAULT: "var(--tertiary-500)",
          500: "var(--tertiary-500)",
          600: "var(--tertiary-600)",
          50:  "var(--tertiary-50)",
        },
        // ── Texto FIXO sobre fundo banana (NÃO inverte com tema) ──────────
        // Usar via: text-ink-on-banana, bg-ink-on-banana, etc.
        "ink-on-banana": {
          DEFAULT: "var(--ink-on-banana)",
          muted:   "var(--ink-on-banana-muted)",
          subtle:  "var(--ink-on-banana-subtle)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        display: ["var(--font-display)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
      },
      boxShadow: {
        banana: "var(--shadow-banana)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  // tailwindcss-animate removido na migração TW4 — substituído por tw-animate-css
  // (importado em client/src/index.css). @tailwindcss/typography é compatível com v4.
  plugins: [require("@tailwindcss/typography")],
} satisfies Config;
