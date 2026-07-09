// ─────────────────────────────────────────────────────────────────────────
// Marca "Norte Gestão CRM" — identidade Azul Norte (redesign 2026-07).
// Substitui o antigo lockup banana (BananaMascot/ChatBananaLogo) na casca.
// Monograma "N" em quadrado azul + wordmark "Norte Gestão" com tag "CRM".
// `compact` mostra só o monograma (sidebar recolhida).
// ─────────────────────────────────────────────────────────────────────────

export function NorteMark({ size = 32, circle = true }: { size?: number; circle?: boolean }) {
  return (
    <span
      className={`grid place-items-center font-display font-extrabold text-primary-foreground flex-shrink-0 select-none ${circle ? "rounded-full" : "rounded-lg"}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.46,
        background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--secondary, var(--primary))))",
        boxShadow: "0 2px 8px -2px hsl(var(--primary) / 0.5)",
      }}
      aria-hidden="true"
    >
      N
    </span>
  );
}

export function NorteBrand({
  compact = false,
  size = 32,
  className = "",
}: {
  compact?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <span className={`flex items-center gap-2.5 min-w-0 ${className}`}>
      <NorteMark size={size} />
      {!compact && (
        <span className="flex flex-col min-w-0 leading-none">
          <span className="font-display font-bold text-[15px] tracking-tight text-foreground truncate">
            Norte Gestão
          </span>
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-primary mt-[3px]">
            CRM
          </span>
        </span>
      )}
    </span>
  );
}
