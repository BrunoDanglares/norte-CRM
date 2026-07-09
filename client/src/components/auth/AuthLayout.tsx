// Shell das telas de autenticação (login + criar conta). Redesign Norte 2026-07:
// painel esquerdo Azul Norte (era ouro banana + mascote/copy ISP), formulário à
// direita. Forçado LIGHT enquanto montado pra a divisão azul/branco ficar fixa.
import { useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Headset, Zap, Users } from "lucide-react";
import { NorteBrand, NorteMark } from "@/components/brand/NorteBrand";
import { AuthTopNav } from "@/components/auth/AuthTopNav";

const BENEFITS = [
  {
    icon: Headset,
    title: "Atende no WhatsApp em segundos",
    desc: "Dúvidas, orçamentos e suporte resolvidos na hora, 24 horas por dia — sem fila.",
  },
  {
    icon: Zap,
    title: "Automações e IA sem código",
    desc: "Fluxos visuais e o Assistente Norte respondendo sozinho o que é repetitivo.",
  },
  {
    icon: Users,
    title: "Chama um humano só quando precisa",
    desc: "Casos sensíveis vão pro time certo, com todo o contexto já reunido.",
  },
];

interface AuthLayoutProps {
  children: React.ReactNode;
  logoHeight?: number;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  const reduce = useReducedMotion();

  // Força light enquanto a tela de auth está montada; restaura ao sair.
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    if (wasDark) root.classList.remove("dark");
    return () => {
      if (wasDark) root.classList.add("dark");
    };
  }, []);

  return (
    <div className="min-h-screen w-full flex bg-white relative" data-testid="auth-layout">
      <AuthTopNav />

      {/* ───────── ESQUERDA — painel Violeta Norte ───────── */}
      <aside
        className="hidden lg:flex lg:w-1/2 relative overflow-hidden flex-col justify-between px-12 xl:px-16 py-8 text-white"
        style={{
          background: "linear-gradient(160deg, #9d6bf8 0%, #7c3aed 45%, #6a24d9 78%, #37146e 100%)",
        }}
      >
        {/* Profundidade: halos suaves + monograma marca d'água */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 18% 12%, rgba(255,255,255,0.22) 0%, transparent 34%)," +
              "radial-gradient(circle at 88% 90%, rgba(0,0,0,0.18) 0%, transparent 42%)",
          }}
        />
        <div aria-hidden="true" className="absolute -right-10 -bottom-10 opacity-[0.08] pointer-events-none">
          <NorteMark size={320} />
        </div>

        <div className="relative z-10 flex-1 flex flex-col justify-center py-4">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="inline-flex items-center rounded-full px-3 py-1 text-[12px] font-bold tracking-wide bg-white/15 backdrop-blur">
              Atendimento com IA
            </span>
            <h1 className="mt-4 text-[32px] xl:text-[40px] font-extrabold leading-[1.05] tracking-[-0.02em] max-w-[18ch]">
              Todo o atendimento da sua empresa num só lugar.
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed max-w-[42ch] text-white/85">
              WhatsApp, Instagram, automações e CRM — o Assistente Norte responde
              na hora e passa pro time só quando realmente precisa.
            </p>
          </motion.div>
        </div>

        {/* Benefícios */}
        <ul className="relative z-10 space-y-2.5">
          {BENEFITS.map((b) => (
            <li key={b.title} className="flex items-start gap-3">
              <span className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-white/15">
                <b.icon className="w-[18px] h-[18px] text-white" />
              </span>
              <div className="min-w-0">
                <p className="text-[14px] font-bold leading-tight">{b.title}</p>
                <p className="text-[12.5px] leading-snug text-white/75">{b.desc}</p>
              </div>
            </li>
          ))}
        </ul>
      </aside>

      {/* ───────── DIREITA — fundo branco com o formulário ───────── */}
      <main className="flex-1 lg:w-1/2 flex flex-col items-center justify-center bg-white px-6 py-5 sm:px-10">
        <div className="w-full max-w-[400px]">
          <div className="flex justify-center mb-4">
            <NorteBrand size={44} />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
