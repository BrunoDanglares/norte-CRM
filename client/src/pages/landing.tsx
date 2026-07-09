// Landing pública do Norte Gestão CRM (redesign Norte 2026-07). Reescrita do zero:
// a antiga vendia o "Agente Banana ISP" (produto ISP removido). Identidade Azul
// Norte, marketing genérico de CRM omnichannel. CTAs: /register · /login.
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  Check, Menu, X, ArrowRight, Bot, Zap, BarChart3, Users, Inbox,
  MessagesSquare, ShieldCheck, Sparkles, Headset, Clock,
} from "lucide-react";
import { SiWhatsapp, SiInstagram, SiMeta } from "react-icons/si";
import { authService } from "../services/auth";
import { NorteBrand, NorteMark } from "@/components/brand/NorteBrand";

const NORTE = "#7c3aed";
const NORTE_DARK = "#6a24d9";
const INK = "#0a0e14";

const SECTIONS: [string, string][] = [
  ["Recursos", "recursos"],
  ["Como funciona", "como"],
  ["Canais", "canais"],
  ["Planos", "planos"],
];

const FEATURES = [
  { icon: Inbox, title: "Caixa de entrada única", desc: "WhatsApp, Instagram e mais num só painel — toda a equipe atendendo do mesmo lugar, sem perder conversa." },
  { icon: Bot, title: "Assistente Norte (IA)", desc: "Responde na hora o que é repetitivo — dúvidas, orçamentos, triagem — e chama um humano só quando precisa." },
  { icon: Zap, title: "Automações sem código", desc: "Monte fluxos visuais de atendimento e follow-up arrastando blocos. Sem depender de programador." },
  { icon: MessagesSquare, title: "CRM e funil de vendas", desc: "Kanban de leads, tags, etapas e histórico completo de cada cliente — do primeiro oi ao fechamento." },
  { icon: BarChart3, title: "Relatórios que importam", desc: "Volume, tempo de resposta, resolvidos e desempenho da equipe — decisões com dado, não achismo." },
  { icon: Users, title: "Equipe e permissões", desc: "Departamentos, atribuição automática e visão por atendente. Cada um vê o que precisa." },
];

const STEPS = [
  { n: "1", icon: SiMeta, title: "Conecte seus canais", desc: "WhatsApp oficial (Meta), Evolution ou Instagram — em minutos, num painel só." },
  { n: "2", icon: Bot, title: "Ative o Assistente Norte", desc: "A IA atende sozinha o repetitivo e passa pro time com todo o contexto reunido." },
  { n: "3", icon: BarChart3, title: "Acompanhe e escale", desc: "Funil, automações e relatórios pra crescer o atendimento sem crescer o custo." },
];

export default function Landing() {
  const [, setLocation] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (authService.isAuthenticated()) setLocation("/inicio");
  }, [setLocation]);

  const go = (path: string) => { setMenuOpen(false); setLocation(path); };
  const scrollTo = (id: string) => {
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen bg-white text-[#0a0e14]" style={{ fontFamily: "'Inclusive Sans', Inter, system-ui, sans-serif" }}>
      {/* ── NAV ── */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-white/85 backdrop-blur border-b border-black/5">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <button onClick={() => go("/landing")} className="flex items-center"><NorteBrand /></button>
          <div className="hidden lg:flex items-center gap-7">
            {SECTIONS.map(([label, id]) => (
              <button key={id} onClick={() => scrollTo(id)} className="text-[13px] text-gray-600 hover:text-gray-900 font-medium transition-colors">{label}</button>
            ))}
            <button onClick={() => go("/login")} className="text-[13px] text-gray-600 hover:text-gray-900 font-medium">Entrar</button>
            <button onClick={() => go("/register")} className="inline-flex items-center gap-2 font-bold rounded-xl h-9 px-5 text-sm text-white transition-all active:scale-[0.97]" style={{ background: NORTE, boxShadow: `0 12px 32px ${NORTE}45` }}>Começar grátis</button>
          </div>
          <button className="lg:hidden text-gray-700" onClick={() => setMenuOpen(!menuOpen)} aria-label="menu">{menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}</button>
        </div>
        {menuOpen && (
          <div className="lg:hidden border-t border-gray-100 bg-white px-4 py-3 space-y-1">
            {SECTIONS.map(([label, id]) => (
              <button key={id} onClick={() => scrollTo(id)} className="block w-full text-left text-sm text-gray-700 py-2">{label}</button>
            ))}
            <button onClick={() => go("/login")} className="block w-full text-left text-sm text-gray-700 py-2">Entrar</button>
            <button onClick={() => go("/register")} className="w-full inline-flex items-center justify-center gap-2 font-bold rounded-xl h-10 text-sm mt-1 text-white" style={{ background: NORTE }}>Começar grátis</button>
          </div>
        )}
      </nav>

      {/* ── HERO ── */}
      <section className="relative pt-32 pb-20 lg:pt-40 lg:pb-28 overflow-hidden" style={{ background: `linear-gradient(180deg, #ffffff 0%, #f2f7ff 100%)` }}>
        <div aria-hidden className="absolute -top-24 -right-24 w-[520px] h-[520px] rounded-full opacity-[0.10] pointer-events-none" style={{ background: `radial-gradient(circle, ${NORTE}, transparent 70%)` }} />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold" style={{ background: `${NORTE}15`, color: NORTE_DARK }}>
              <Sparkles className="w-3.5 h-3.5" /> CRM + Atendimento com IA
            </span>
            <h1 className="mt-4 text-4xl sm:text-5xl lg:text-[52px] font-extrabold leading-[1.08] tracking-tight">
              Todo o atendimento da sua empresa, <span style={{ color: NORTE }}>num só lugar.</span>
            </h1>
            <p className="mt-5 text-[16px] leading-relaxed text-gray-600 max-w-[46ch]">
              WhatsApp, Instagram, automações e CRM no <strong className="text-[#0a0e14]">Norte Gestão CRM</strong> — o Assistente Norte responde na hora e passa pro seu time só quando precisa.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button onClick={() => go("/register")} className="inline-flex items-center gap-2 font-bold rounded-xl h-12 px-7 text-[15px] text-white transition-all active:scale-[0.97]" style={{ background: NORTE, boxShadow: `0 14px 36px ${NORTE}40` }}>
                Começar grátis <ArrowRight className="w-4 h-4" />
              </button>
              <button onClick={() => go("/login")} className="inline-flex items-center gap-2 font-semibold rounded-xl h-12 px-6 text-[15px] border border-gray-200 hover:border-gray-300 transition-colors">
                <Headset className="w-4 h-4" /> Entrar
              </button>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
              {["Sem cartão pra testar", "Isolamento por empresa (LGPD)", "Suporte em português"].map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5 text-[13px] text-gray-500"><Check className="w-4 h-4" style={{ color: NORTE }} />{t}</span>
              ))}
            </div>
          </div>

          {/* mock visual */}
          <div className="relative">
            <div className="rounded-3xl border border-black/8 bg-white shadow-[0_24px_60px_-20px_rgba(20,116,255,0.35)] overflow-hidden">
              <div className="h-11 flex items-center gap-2 px-4 border-b border-black/5" style={{ background: "#f2f7ff" }}>
                <NorteMark size={22} /><span className="text-[12px] font-bold">Norte Gestão CRM</span>
                <span className="ml-auto flex gap-1"><i className="w-2.5 h-2.5 rounded-full bg-gray-200" /><i className="w-2.5 h-2.5 rounded-full bg-gray-200" /><i className="w-2.5 h-2.5 rounded-full bg-gray-200" /></span>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  {[["128", "Leads", NORTE], ["94%", "Resolvidos", "#16a34a"], ["2m", "Resposta", "#1474ff"]].map(([v, l, c]) => (
                    <div key={l} className="rounded-xl border border-black/5 p-3" style={{ borderLeft: `3px solid ${c}` }}>
                      <div className="text-[20px] font-extrabold" style={{ color: c as string }}>{v}</div>
                      <div className="text-[10px] text-gray-500">{l}</div>
                    </div>
                  ))}
                </div>
                {[["WhatsApp API Oficial", "#25D366", true], ["Instagram Direct", "#E1306C", false]].map(([n, c, on]) => (
                  <div key={n as string} className="rounded-xl border border-black/5 p-3 flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg grid place-items-center" style={{ background: `${c}1f` }}><SiWhatsapp className="w-4 h-4" style={{ color: c as string }} /></span>
                    <span className="text-[12px] font-semibold flex-1">{n}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: on ? "#16a34a1f" : "#f1f5f9", color: on ? "#16a34a" : "#94a3b8" }}>{on ? "Conectado" : "Off"}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── TRUST STRIP ── */}
      <section className="py-8 border-y border-black/5" style={{ background: "#fafcff" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-gray-400">
          <span className="text-[12px] font-semibold uppercase tracking-wider">Canais no mesmo painel:</span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#25D366]"><SiWhatsapp className="w-5 h-5" /> WhatsApp</span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#E1306C]"><SiInstagram className="w-5 h-5" /> Instagram</span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#0082FB]"><SiMeta className="w-5 h-5" /> Meta Cloud API</span>
        </div>
      </section>

      {/* ── RECURSOS ── */}
      <section id="recursos" className="py-24 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold" style={{ background: `${NORTE}12`, color: NORTE_DARK }}><Sparkles className="w-3.5 h-3.5" /> Recursos</span>
            <h2 className="mt-4 text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">Tudo pra atender melhor e vender mais</h2>
            <p className="mt-3 text-gray-600">Um CRM feito pra quem atende no WhatsApp e no Instagram todos os dias.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-black/6 bg-white p-6 hover:shadow-[0_16px_40px_-16px_rgba(20,116,255,0.25)] hover:border-[color:var(--n)]/30 transition-all" style={{ ["--n" as any]: NORTE }}>
                <span className="w-11 h-11 rounded-xl grid place-items-center mb-4" style={{ background: `${NORTE}12`, color: NORTE }}><f.icon className="w-5 h-5" /></span>
                <h3 className="text-[16px] font-bold mb-1.5">{f.title}</h3>
                <p className="text-[13.5px] text-gray-600 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── COMO FUNCIONA ── */}
      <section id="como" className="py-24 scroll-mt-16" style={{ background: "linear-gradient(180deg, #f2f7ff 0%, #ffffff 100%)" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">Do zero ao atendimento no automático em 3 passos</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {STEPS.map((s) => (
              <div key={s.n} className="relative rounded-2xl border border-black/6 bg-white p-7">
                <div className="w-10 h-10 rounded-full grid place-items-center text-white font-extrabold mb-4" style={{ background: NORTE }}>{s.n}</div>
                <s.icon className="w-6 h-6 mb-3" style={{ color: NORTE }} />
                <h3 className="text-[17px] font-bold mb-1.5">{s.title}</h3>
                <p className="text-[13.5px] text-gray-600 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CANAIS ── */}
      <section id="canais" className="py-24 scroll-mt-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold" style={{ background: `${NORTE}12`, color: NORTE_DARK }}><MessagesSquare className="w-3.5 h-3.5" /> Omnichannel</span>
          <h2 className="mt-4 text-3xl sm:text-4xl font-extrabold tracking-tight">WhatsApp e Instagram na mesma caixa de entrada</h2>
          <p className="mt-3 text-gray-600 max-w-2xl mx-auto">Canal oficial da Meta (sem risco de banimento), Evolution e DMs do Instagram — com o mesmo Assistente Norte e os mesmos relatórios.</p>
          <div className="mt-10 grid sm:grid-cols-3 gap-5">
            {[
              { icon: SiWhatsapp, c: "#25D366", t: "WhatsApp Oficial", d: "Homologado pela Meta, templates aprovados." },
              { icon: SiWhatsapp, c: "#10b981", t: "WhatsApp Evolution", d: "Sessão do WhatsApp comum, rápido de conectar." },
              { icon: SiInstagram, c: "#E1306C", t: "Instagram Direct", d: "DMs + prospecção com IA, no mesmo painel." },
            ].map((c) => (
              <div key={c.t} className="rounded-2xl border border-black/6 bg-white p-6 text-left">
                <span className="w-11 h-11 rounded-xl grid place-items-center mb-3" style={{ background: `${c.c}18` }}><c.icon className="w-5 h-5" style={{ color: c.c }} /></span>
                <h3 className="text-[15px] font-bold mb-1">{c.t}</h3>
                <p className="text-[13px] text-gray-600">{c.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA FINAL ── */}
      <section id="planos" className="py-24 scroll-mt-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="relative rounded-3xl overflow-hidden text-white text-center px-6 py-16" style={{ background: `linear-gradient(135deg, ${NORTE} 0%, ${NORTE_DARK} 55%, #37146e 100%)` }}>
            <div aria-hidden className="absolute -right-16 -bottom-16 opacity-[0.12] pointer-events-none"><NorteMark size={280} /></div>
            <div className="relative">
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">Comece a atender melhor hoje</h2>
              <p className="mt-3 text-white/85 max-w-xl mx-auto">Crie sua conta grátis, conecte um canal e veja o Assistente Norte trabalhando em minutos.</p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <button onClick={() => go("/register")} className="inline-flex items-center gap-2 font-bold rounded-xl h-12 px-8 text-[15px] bg-white transition-all active:scale-[0.97]" style={{ color: NORTE_DARK }}>
                  Criar conta grátis <ArrowRight className="w-4 h-4" />
                </button>
                <button onClick={() => go("/login")} className="inline-flex items-center gap-2 font-semibold rounded-xl h-12 px-6 text-[15px] border border-white/30 hover:bg-white/10 transition-colors">Já tenho conta</button>
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-white/80 text-[13px]">
                <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> LGPD</span>
                <span className="inline-flex items-center gap-1.5"><Clock className="w-4 h-4" /> Setup em minutos</span>
                <span className="inline-flex items-center gap-1.5"><Check className="w-4 h-4" /> Cancele quando quiser</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-black/5 py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <NorteBrand />
          <div className="flex items-center gap-5 text-[13px] text-gray-500">
            <a href="/termos" className="hover:text-gray-800">Termos</a>
            <a href="/privacidade" className="hover:text-gray-800">Privacidade</a>
            <button onClick={() => go("/login")} className="hover:text-gray-800">Entrar</button>
          </div>
          <p className="text-[12px] text-gray-400">© 2026 Norte Gestão CRM</p>
        </div>
      </footer>
    </div>
  );
}
