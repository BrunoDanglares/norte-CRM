// Pílula de status (conectado/ativo vs inativo) — segue --primary do tema.
// Compartilhada entre a tela inicial (inicio.tsx) e o carrossel de boas-vindas.
import { CheckCircle2, Circle } from "lucide-react";

export function StatusPill({ on, labelOn = "Conectado", labelOff = "Inativo" }: { on: boolean; labelOn?: string; labelOff?: string }) {
  if (on) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
        style={{ background: "hsl(var(--primary) / 0.14)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary) / 0.30)" }}
      >
        <CheckCircle2 className="w-2.5 h-2.5" /> {labelOn}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-muted-foreground border border-border bg-muted/30">
      <Circle className="w-2.5 h-2.5" /> {labelOff}
    </span>
  );
}
