import { Eye } from "lucide-react";
import { isImpersonating, impersonatedUserName, exitImpersonation } from "@/lib/impersonation";

// Faixa "modo visualização" mostrada no topo de QUALQUER layout (gestão, modo
// Atendimento, embed) quando o super-admin está dentro do workspace de um tenant.
// Renderiza nada se não estiver impersonando.
export function ImpersonationBanner() {
  if (!isImpersonating()) return null;
  return (
    <div
      className="bg-amber-500 text-black px-4 py-1.5 flex items-center justify-between gap-3 text-[12px] font-semibold flex-shrink-0 z-50"
      data-testid="banner-impersonation"
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <Eye className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate">
          Modo visualização — você está acessando o workspace de <b>{impersonatedUserName()}</b>
        </span>
      </span>
      <button
        onClick={exitImpersonation}
        className="bg-black/20 hover:bg-black/30 text-black px-3 py-0.5 rounded text-[11px] font-bold transition-colors whitespace-nowrap flex-shrink-0"
        data-testid="button-exit-impersonation"
      >
        Voltar ao painel
      </button>
    </div>
  );
}
