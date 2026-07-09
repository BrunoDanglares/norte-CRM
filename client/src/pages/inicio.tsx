// Tela inicial / Boas-vindas — ponto de entrada pós-login.
// Redesign Norte (2026-07): reconstruída FIEL ao dashboard do ERP Norte Gestão
// (template Nexus) — cabeçalho + breadcrumb, KPIs com borda lateral colorida,
// data-first, cards daisyUI. Identidade Norte Gestão CRM, sem banana/ISP.

import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  MessageSquare, Sparkles, Zap, BarChart3, Link2, Radio,
  ArrowRight, CheckCircle2, CreditCard, Brain,
  Inbox as InboxIcon, Headset, Bell, Plug, ShieldCheck,
  TrendingUp, PieChart as PieChartIcon,
} from "lucide-react";
import { SiWhatsapp, SiMeta, SiInstagram } from "react-icons/si";
import { authService } from "@/services/auth";
import { AreaChart, DonutChart } from "@/components/charts";

interface EmpresaResp { ok: boolean; data: { nome?: string; razaoSocial?: string; logo?: string } }
interface IntegResp { ok: boolean; data: Record<string, { enabled: boolean; config: any }> }
interface ConexaoAPI { id: string; nome: string; tipo: string; provider: string; numero: string | null; status: string }
interface ConexoesResp { ok: boolean; data: ConexaoAPI[] }
interface WaOficialResp { connected?: boolean; data?: { businessName?: string; displayPhoneNumber?: string } }
interface IgStatusResp { connected?: boolean; username?: string; pageName?: string }

export default function Inicio() {
  const user = authService.getUser();
  const firstName = (user?.nome || "").trim().split(/\s+/)[0] || "por aí";

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "Bom dia";
    if (h < 18) return "Boa tarde";
    return "Boa noite";
  }, []);

  const { data: empresa } = useQuery<EmpresaResp>({ queryKey: ["/api/workspace/empresa"] });
  const { data: integ } = useQuery<IntegResp>({ queryKey: ["/api/integrations/config"] });
  const { data: conexoes } = useQuery<ConexoesResp>({ queryKey: ["/api/conexoes"] });
  const { data: waOficial } = useQuery<WaOficialResp>({ queryKey: ["/api/whatsapp-official/connection"] });
  const { data: ig } = useQuery<IgStatusResp>({ queryKey: ["/api/instagram/status"] });
  const { data: conversas } = useQuery<any[]>({ queryKey: ["/api/conversations"], staleTime: 15000 });

  const companyName = empresa?.data?.nome || empresa?.data?.razaoSocial || "sua empresa";
  const integMap = integ?.data || {};

  const waOficialOn = !!waOficial?.connected;
  const waOficialNumero = waOficial?.data?.displayPhoneNumber || "";
  const waOficialNome = waOficial?.data?.businessName || "";

  const evoConn = useMemo(() => {
    const list = conexoes?.data || [];
    return list.find((c) => /whats/i.test(c.tipo) || /evolution/i.test(c.provider)) || null;
  }, [conexoes]);
  const evoOn = evoConn?.status === "connected";
  const igOn = !!ig?.connected;

  const stats = useMemo(() => {
    const list = Array.isArray(conversas) ? conversas : [];
    return {
      abertas: list.filter((c) => c.status !== "resolved").length,
      naoLidas: list.filter((c) => (c.unread || 0) > 0 && c.status !== "resolved").length,
      resolvidas: list.filter((c) => c.status === "resolved").length,
    };
  }, [conversas]);

  // Atividade das últimas 8 semanas (conversas iniciadas por semana) — pro gráfico.
  // Janela larga p/ sempre "puxar" dado mesmo com histórico antigo; usa createdAt
  // (campo real da tabela conversations), com fallback updatedAt/lastCustomerMessageAt.
  const activity = useMemo(() => {
    const list = Array.isArray(conversas) ? conversas : [];
    const getT = (c: any) => new Date(c.createdAt || c.updatedAt || c.lastCustomerMessageAt || 0).getTime();
    const labels: string[] = [];
    const counts: number[] = [];
    for (let i = 7; i >= 0; i--) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - i * 7 - start.getDay()); // domingo da semana
      const end = new Date(start);
      end.setDate(start.getDate() + 7);
      labels.push(start.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }));
      counts.push(list.filter((c) => { const t = getT(c); return t >= start.getTime() && t < end.getTime(); }).length);
    }
    return { days: labels, counts };
  }, [conversas]);

  const integrations = [
    { key: "openai", name: "OpenAI", desc: "Inteligência artificial do atendimento", Icon: Brain, color: "#10a37f", on: integMap?.openai?.enabled ?? false },
    { key: "stripe", name: "Stripe", desc: "Assinatura do Norte Gestão", Icon: CreditCard, color: "#635bff", on: integMap?.stripe?.enabled ?? false },
  ];
  const integAtivas = integrations.filter((i) => i.on).length;
  const canaisAtivos = [waOficialOn, evoOn, igOn].filter(Boolean).length;

  const canais = [
    {
      key: "wa-oficial", nome: "WhatsApp API Oficial", Icon: SiWhatsapp, iconColor: "#25D366", iconBg: "rgba(37,211,102,0.12)",
      on: waOficialOn, recomendado: true, metaBadge: true,
      desc: "Canal oficial homologado pela Meta — número verificado, templates aprovados e sem risco de banimento.",
      detalhe: waOficialOn ? [waOficialNome, waOficialNumero].filter(Boolean).join(" · ") : "",
      manageHref: "/whatsapp-oficial",
    },
    {
      key: "evolution", nome: "WhatsApp Evolution", Icon: SiWhatsapp, iconColor: "#10b981", iconBg: "rgba(16,185,129,0.12)",
      on: evoOn, recomendado: false, metaBadge: false,
      desc: "Canal não-oficial — roda numa sessão do WhatsApp comum. Rápido de conectar, sem selo da Meta.",
      detalhe: evoOn && evoConn?.numero ? evoConn.numero : "",
      manageHref: "/conexoes",
    },
    {
      key: "instagram", nome: "Instagram Direct", Icon: SiInstagram, iconColor: "#E1306C", iconBg: "rgba(225,48,108,0.12)",
      on: igOn, recomendado: false, metaBadge: false,
      desc: "DMs do Instagram + prospecção com IA, no mesmo painel de atendimento.",
      detalhe: igOn ? (ig?.username ? `@${ig.username}` : ig?.pageName || "") : "",
      manageHref: "/conexoes",
    },
  ];

  // Cards de stat no padrão Nexus 4.0.0: ícone em quadradinho neutro + label,
  // número grande, legenda. Bruno 2026-07-04: todos brancos/neutros iguais
  // (o 1º ficava destacado em cor sólida; `highlight` segue disponível se
  // um dia quisermos re-destacar).
  const kpis = [
    { label: "Conversas em aberto", value: stats.abertas, sub: "aguardando atendimento", Icon: MessageSquare, href: "/inbox" },
    { label: "Não lidas", value: stats.naoLidas, sub: "mensagens sem resposta", Icon: Bell, href: "/inbox" },
    { label: "Resolvidas", value: stats.resolvidas, sub: "conversas finalizadas", Icon: CheckCircle2, href: "/relatorios" },
    { label: "Integrações ativas", value: integAtivas, sub: "serviços conectados", Icon: Plug, href: "/integracoes" },
  ];

  const atalhos = [
    { label: "Abrir o Chat", desc: "Atender conversas agora", href: "/inbox", Icon: Headset },
    { label: "CRM", desc: "Funil e contatos", href: "/crm", Icon: InboxIcon },
    { label: "Automações", desc: "Fluxos sem código", href: "/automacoes", Icon: Zap },
    { label: "Relatórios", desc: "Métricas e resultados", href: "/relatorios", Icon: BarChart3 },
    { label: "Integrações", desc: "Conectar serviços", href: "/integracoes", Icon: Link2 },
  ];

  return (
    <div className="h-full overflow-y-auto bg-base-200/40" data-testid="page-inicio">
      <div className="max-w-6xl mx-auto px-5 md:px-8 py-6 space-y-5">

        {/* ── CABEÇALHO DE PÁGINA + BREADCRUMB (assinatura Nexus) ─────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight text-base-content">Início</h1>
            <p className="text-[13px] text-base-content/55 mt-0.5">
              {greeting}, <span className="font-medium text-base-content/80">{firstName}</span> — resumo da {companyName} hoje.
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-3">
            <div className="breadcrumbs text-sm p-0">
              <ul>
                <li className="text-base-content/50">Norte Gestão</li>
                <li className="text-base-content/80">Início</li>
              </ul>
            </div>
            <Link href="/inbox" className="btn btn-primary btn-sm gap-1.5">
              <Headset className="w-4 h-4" /> Abrir o Chat
            </Link>
          </div>
        </div>

        {/* ── Cards de stat (padrão Nexus 4.0.0) ─────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="inicio-stats">
          {kpis.map((k) => {
            const hl = (k as any).highlight;
            return (
              <Link
                key={k.label}
                href={k.href}
                className={`card border transition-all ${hl ? "bg-primary text-primary-content border-primary" : "bg-base-100 border-base-200 hover:border-base-300"}`}
                data-testid={`inicio-stat-${k.label}`}
              >
                <div className="card-body p-5 gap-0">
                  <div className="flex items-center gap-2.5">
                    <span className={`w-9 h-9 rounded-field grid place-items-center shrink-0 ${hl ? "bg-white/15 text-primary-content" : "bg-base-200 text-base-content/70"}`}>
                      <k.Icon className="w-[18px] h-[18px]" />
                    </span>
                    <span className={`text-[13px] font-medium ${hl ? "text-primary-content/85" : "text-base-content/70"}`}>{k.label}</span>
                  </div>
                  <div className={`text-[28px] font-bold tabular-nums leading-none mt-3.5 ${hl ? "text-primary-content" : "text-base-content"}`}>{k.value}</div>
                  <div className={`text-[11px] mt-1.5 ${hl ? "text-primary-content/70" : "text-base-content/45"}`}>{k.sub}</div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* ── GRÁFICOS (atividade + status) ──────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" data-testid="inicio-graficos">
          <div className="lg:col-span-2 card bg-base-100 border border-base-200">
            <div className="card-body p-5">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                <h3 className="text-[14px] font-semibold tracking-tight">Atendimentos por dia</h3>
              </div>
              <p className="text-[11.5px] text-base-content/55 -mt-0.5 mb-1">Conversas iniciadas por semana (últimas 8 semanas)</p>
              <AreaChart
                categories={activity.days}
                series={[{ name: "Conversas", data: activity.counts, color: "#7c3aed" }]}
                colors={["#7c3aed"]}
                height={230}
                showLegend={false}
              />
            </div>
          </div>
          <div className="card bg-base-100 border border-base-200">
            <div className="card-body p-5">
              <div className="flex items-center gap-2">
                <PieChartIcon className="w-4 h-4 text-primary" />
                <h3 className="text-[14px] font-semibold tracking-tight">Status das conversas</h3>
              </div>
              <p className="text-[11.5px] text-base-content/55 -mt-0.5">Distribuição atual</p>
              <DonutChart
                labels={["Em aberto", "Resolvidas"]}
                series={[stats.abertas, stats.resolvidas]}
                colors={["#7c3aed", "#16a34a"]}
                centerLabel="Total"
                centerValue={String(stats.abertas + stats.resolvidas)}
                height={210}
              />
              <div className="flex items-center justify-center gap-4">
                <span className="flex items-center gap-1.5 text-[11px] text-base-content/70"><span className="w-2 h-2 rounded-full" style={{ background: "#7c3aed" }} />Em aberto <b className="tabular-nums">{stats.abertas}</b></span>
                <span className="flex items-center gap-1.5 text-[11px] text-base-content/70"><span className="w-2 h-2 rounded-full" style={{ background: "#16a34a" }} />Resolvidas <b className="tabular-nums">{stats.resolvidas}</b></span>
              </div>
            </div>
          </div>
        </div>

        {/* ── CANAIS ─────────────────────────────────────────────────────── */}
        <section data-testid="inicio-canais">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-primary" />
              <h2 className="text-[15px] font-semibold tracking-tight">Canais de atendimento</h2>
              <span className="badge badge-ghost badge-sm text-[10.5px]">{canaisAtivos} conectado{canaisAtivos === 1 ? "" : "s"}</span>
            </div>
            <Link href="/conexoes" className="text-[12px] font-semibold text-primary inline-flex items-center gap-1 hover:underline">
              Gerenciar canais <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {canais.map((c) => (
              <div
                key={c.key}
                className={`card bg-base-100 border transition-colors ${c.recomendado && c.on ? "border-primary/40" : "border-base-200"} hover:border-primary/30`}
                data-testid={`inicio-canal-${c.key}`}
              >
                <div className="card-body p-5 gap-3">
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-field grid place-items-center shrink-0" style={{ background: c.iconBg }}>
                      <c.Icon className="w-5 h-5" style={{ color: c.iconColor }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="text-[13.5px] font-bold leading-tight">{c.nome}</h3>
                        {c.recomendado && <span className="badge badge-primary badge-soft badge-sm gap-1 text-[9px] font-bold"><Sparkles className="w-2.5 h-2.5" />Recomendado</span>}
                      </div>
                      {c.metaBadge && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-base-content/55 mt-0.5">
                          <SiMeta className="w-3 h-3" style={{ color: "#0082FB" }} /> Meta Cloud API
                        </span>
                      )}
                    </div>
                    <span className={`badge badge-sm badge-soft ${c.on ? "badge-success" : "badge-ghost"} text-[10px] font-semibold`}>
                      {c.on ? "Conectado" : "Off"}
                    </span>
                  </div>

                  <p className="text-[11.5px] text-base-content/55 leading-relaxed flex-1">{c.desc}</p>

                  <div className="flex items-center justify-between gap-2 border-t border-base-200 pt-2.5 mt-auto">
                    {c.on ? (
                      <span className="inline-flex items-center gap-1.5 min-w-0 text-[11px] text-base-content/55">
                        {c.recomendado && <ShieldCheck className="w-3 h-3 shrink-0 text-primary" />}
                        <span className="truncate font-medium text-base-content/75">{c.detalhe || "Conectado"}</span>
                      </span>
                    ) : (
                      <span className="text-[11px] text-base-content/45">Sem conexão</span>
                    )}
                    <Link href={c.manageHref} className="text-[11.5px] font-semibold text-primary inline-flex items-center gap-1 hover:underline shrink-0">
                      {c.on ? "Gerenciar" : "Conectar"} <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── INTEGRAÇÕES + ATALHOS ──────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <section data-testid="inicio-integracoes">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Link2 className="w-4 h-4 text-primary" />
                <h2 className="text-[15px] font-semibold tracking-tight">Integrações</h2>
                <span className="badge badge-ghost badge-sm text-[10.5px]">{integAtivas} ativa{integAtivas === 1 ? "" : "s"}</span>
              </div>
              <Link href="/integracoes" className="text-[12px] font-semibold text-primary inline-flex items-center gap-1 hover:underline">
                Ver todas <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {integrations.map((it) => (
                <div key={it.key} className="card bg-base-100 border border-base-200" data-testid={`inicio-integ-${it.key}`}>
                  <div className="card-body p-4 flex-row items-center gap-3">
                    <div className="w-10 h-10 rounded-field grid place-items-center shrink-0" style={{ background: `${it.color}1f` }}>
                      <it.Icon className="w-5 h-5" style={{ color: it.color }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold truncate">{it.name}</span>
                        <span className={`badge badge-xs badge-soft ${it.on ? "badge-success" : "badge-ghost"} font-semibold`}>{it.on ? "Ativa" : "Off"}</span>
                      </div>
                      <p className="text-[11px] text-base-content/55 truncate">{it.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section data-testid="inicio-atalhos">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-primary" />
              <h2 className="text-[15px] font-semibold tracking-tight">Atalhos rápidos</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {atalhos.map((a) => (
                <Link
                  key={a.href}
                  href={a.href}
                  className="card bg-base-100 border border-base-200 hover:border-primary/30 transition-colors group"
                  data-testid={`inicio-atalho-${a.href}`}
                >
                  <div className="card-body p-4 flex-row items-center gap-3">
                    <div className="w-10 h-10 rounded-field grid place-items-center bg-primary/10 text-primary shrink-0">
                      <a.Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-bold truncate">{a.label}</div>
                      <p className="text-[11px] text-base-content/55 truncate">{a.desc}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-base-content/30 group-hover:text-primary transition-colors" />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </div>

      </div>
    </div>
  );
}
