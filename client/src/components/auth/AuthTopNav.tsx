// Barra superior das telas de auth (login/registro). Redesign Norte 2026-07:
// simplificada — só Entrar + Começar grátis, alinhados à direita (sobre o painel
// branco do formulário). As seções antigas (ISP) foram removidas.
import { useLocation } from "wouter";

const NORTE = "#7c3aed";

export function AuthTopNav() {
  const [, setLocation] = useLocation();
  const go = (path: string) => setLocation(path);

  return (
    <nav className="absolute top-0 inset-x-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-end gap-5">
        <button
          type="button"
          onClick={() => go("/login")}
          className="text-[13px] text-gray-600 hover:text-gray-900 font-medium transition-colors"
        >
          Entrar
        </button>
        <button
          type="button"
          onClick={() => go("/register")}
          style={{ background: NORTE, color: "#fff", boxShadow: `0 12px 32px ${NORTE}45` }}
          className="inline-flex items-center justify-center gap-2 font-bold rounded-xl transition-all active:scale-[0.97] hover:brightness-[1.03] h-9 px-5 text-sm"
        >
          Começar grátis
        </button>
      </div>
    </nav>
  );
}
