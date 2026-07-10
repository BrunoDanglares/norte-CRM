// Instaflix — automação de postagem no Instagram com IA (carrossel/imagem).
// Padrão Nexus: cabeçalho + abas .seg-tab + cards 2-col. Bruno 2026-07-04.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, apiUpload } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Clapperboard, Sparkles, Palette, Layers, CalendarClock, Loader2, Save, Trash2,
  Plus, Check, X, Send, Images, ImageIcon, Instagram, RefreshCw, Database, Globe,
  Upload, FileText, ChevronLeft, ChevronRight, ChevronDown,
} from "lucide-react";
import { DateTimeLocalPicker } from "@/components/ui/date-time-picker";

type Tab = "estudio" | "marca" | "pilares" | "agenda";

const SUBS: { key: Tab; label: string; icon: any }[] = [
  { key: "estudio", label: "Estúdio", icon: Sparkles },
  { key: "marca", label: "Marca", icon: Palette },
  { key: "pilares", label: "Pilares", icon: Layers },
  { key: "agenda", label: "Agenda", icon: CalendarClock },
];

// O ESTILO (tom) não é mais escolhido pela UI — a IA escolhe o melhor do conjunto do
// segmento (ver escolherEstiloAuto no backend). Bruno 2026-07-09.
// Objetivo / CTA do post (batem com OBJETIVOS_CTA no backend). "auto" = IA decide.
const OBJETIVOS_POST: { value: string; label: string }[] = [
  { value: "auto", label: "Automático" },
  { value: "vender_app", label: "Vender no app" },
  { value: "whatsapp", label: "Chamar no WhatsApp" },
  { value: "seguidores", label: "Ganhar seguidores" },
  { value: "agendar", label: "Agendar / reservar" },
];

const STATUS_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  gerando: "Gerando",
  aguardando_aprovacao: "Aguardando aprovação",
  agendado: "Agendado",
  publicando: "Publicando",
  publicado: "Publicado",
  falhou: "Falhou",
  reprovado: "Reprovado",
};
const STATUS_CLASS: Record<string, string> = {
  gerando: "bg-primary/15 text-primary border-primary/30",
  aguardando_aprovacao: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  agendado: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  publicado: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  publicando: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  falhou: "bg-red-500/15 text-red-600 border-red-500/30",
  reprovado: "bg-base-content/10 text-base-content/60 border-base-content/20",
};

// Normaliza a URL de uma mídia pro preview: se veio absoluta apontando pro nosso
// /uploads (ex.: posts antigos que gravaram a URL de um túnel ngrok/produção),
// devolve só o caminho same-origin — assim a imagem carrega do host atual em vez
// de um túnel que pode estar fora do ar. Bruno 2026-07-07.
function midiaSrc(u?: string): string {
  if (!u) return "";
  const i = u.indexOf("/uploads/");
  if (i >= 0 && /^https?:\/\//i.test(u)) return u.slice(i);
  return u;
}

// ════════════════════════════════════════════════════════════════════════════
// ONBOARDING do módulo — questionário inicial + conectar Instagram + logo.
// Aparece na primeira vez (brand kit sem onboardingConcluido). Bruno 2026-07-09.
// ════════════════════════════════════════════════════════════════════════════
const ONB_STEPS = ["Seu negócio", "Instagram", "Logo", "Pronto"];

function InstaflixOnboarding() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: bk } = useQuery<any>({ queryKey: ["/api/instaflix/brand-kit"] });
  const { data: segmentos = [] } = useQuery<any[]>({ queryKey: ["/api/instaflix/segmentos"] });
  const { data: igStatus, refetch: refetchIg, isFetching: igFetching } = useQuery<any>({ queryKey: ["/api/instagram/status"] });

  const [step, setStep] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [enviandoLogo, setEnviandoLogo] = useState(false);
  const [conectando, setConectando] = useState(false);
  const [preenchido, setPreenchido] = useState(false);
  const [form, setForm] = useState({ segmento: "", descricaoNegocio: "", produtosServicos: "", publicoAlvo: "", tomVoz: "" });

  // Pré-preenche do brand kit uma vez (se o cliente já tinha começado).
  useEffect(() => {
    if (bk && !preenchido) {
      setForm({
        segmento: bk.segmento || "",
        descricaoNegocio: bk.descricaoNegocio || "",
        produtosServicos: bk.produtosServicos || "",
        publicoAlvo: bk.publicoAlvo || "",
        tomVoz: bk.tomVoz || "",
      });
      setPreenchido(true);
    }
  }, [bk, preenchido]);

  const igConectado = !!igStatus?.connected;
  const segNome = (Array.isArray(segmentos) ? segmentos : []).find((s) => s.slug === form.segmento)?.nome;

  async function salvarNegocio() {
    if (!form.segmento) { toast({ title: "Escolha o segmento do seu negócio", variant: "destructive" }); return; }
    if (!form.descricaoNegocio.trim()) { toast({ title: "Conte rapidinho o que o negócio faz", variant: "destructive" }); return; }
    setSalvando(true);
    try {
      const res = await apiRequest("PUT", "/api/instaflix/brand-kit", form);
      await res.json();
      qc.invalidateQueries({ queryKey: ["/api/instaflix/brand-kit"] });
      setStep(1);
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    } finally { setSalvando(false); }
  }

  async function conectarInstagram() {
    setConectando(true);
    try {
      const res = await apiRequest("GET", "/api/instagram/ig-auth-url");
      const data = await res.json();
      if (data?.url) {
        // Abre em ABA NOVA: o OAuth redireciona pro Canais ao terminar, então se fosse
        // na mesma aba o wizard sumia. Assim o onboarding sobrevive; o usuário volta e
        // clica "Já conectei". Bruno 2026-07-09 (fix da revisão).
        window.open(data.url, "_blank", "noopener");
        toast({ title: "Conecte na aba que abriu", description: "Depois volte aqui e clique em “Já conectei”." });
      } else {
        throw new Error(data?.error || "Não consegui iniciar a conexão");
      }
    } catch (e: any) {
      toast({ title: "Erro ao conectar", description: e.message, variant: "destructive" });
    } finally {
      setConectando(false);
    }
  }

  async function enviarLogo(file?: File | null) {
    if (!file) return;
    setEnviandoLogo(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await apiUpload("/api/instaflix/brand-kit/logo", fd);
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      qc.invalidateQueries({ queryKey: ["/api/instaflix/brand-kit"] });
      toast({ title: "Logo enviada!" });
    } catch (e: any) {
      toast({ title: "Erro ao enviar logo", description: e.message, variant: "destructive" });
    } finally { setEnviandoLogo(false); }
  }

  // Marca o onboarding como concluído → o gate no Instaflix() libera as abas.
  async function concluir() {
    setSalvando(true);
    try {
      await apiRequest("PUT", "/api/instaflix/brand-kit", { onboardingConcluido: true });
      qc.invalidateQueries({ queryKey: ["/api/instaflix/brand-kit"] });
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
      setSalvando(false);
    }
  }

  return (
    <div className="h-full overflow-auto" data-testid="instaflix-onboarding">
      <div className="max-w-[680px] mx-auto px-5 py-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-field bg-primary flex items-center justify-center flex-shrink-0">
            <Clapperboard className="w-4 h-4 text-primary-content" />
          </div>
          <div className="grow min-w-0">
            <h1 className="text-[17px] font-semibold tracking-tight">Bem-vindo ao Instaflix</h1>
            <p className="text-[12px] text-muted-foreground">Configure o módulo em 1 minuto pra IA criar posts com a sua cara.</p>
          </div>
          <button onClick={concluir} className="text-[11px] text-muted-foreground hover:text-base-content shrink-0" data-testid="onb-pular">Pular por agora</button>
        </div>

        {/* Passos */}
        <div className="flex items-center gap-1.5 my-5">
          {ONB_STEPS.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5 grow">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${i < step ? "bg-primary text-primary-content" : i === step ? "bg-primary/15 text-primary ring-1 ring-primary/40" : "bg-base-200 text-base-content/40"}`}>
                {i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span className={`text-[11px] ${i === step ? "font-semibold" : "text-muted-foreground"} hidden sm:block whitespace-nowrap`}>{s}</span>
              {i < ONB_STEPS.length - 1 && <div className={`h-px grow ${i < step ? "bg-primary/40" : "bg-base-300"}`} />}
            </div>
          ))}
        </div>

        <Card className="p-5">
          {step === 0 && (
            <>
              <div className="flex items-center gap-2 mb-1"><Sparkles className="w-4 h-4 text-primary" /><span className="text-[14px] font-semibold">Sobre o seu negócio</span></div>
              <p className="text-[12px] text-muted-foreground mb-4">É o “cérebro” que a IA usa — quanto melhor, melhores os posts. Dá pra refinar depois na aba Marca.</p>
              <div className="space-y-3">
                <div>
                  <Label className="text-[12px]">Segmento do negócio *</Label>
                  <Select value={form.segmento} onValueChange={(v) => setForm({ ...form, segmento: v })}>
                    <SelectTrigger className="mt-1" data-testid="onb-segmento"><SelectValue placeholder="Escolha o segmento" /></SelectTrigger>
                    <SelectContent>
                      {(Array.isArray(segmentos) ? segmentos : []).map((s) => (<SelectItem key={s.slug} value={s.slug}>{s.nome}</SelectItem>))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10.5px] text-muted-foreground mt-1">Define a “cara” das artes: o que aparece na imagem, o estilo de foto e a luz.</p>
                </div>
                <div>
                  <Label className="text-[12px]">O que o negócio faz *</Label>
                  <Textarea className="mt-1" rows={2} value={form.descricaoNegocio} onChange={(e) => setForm({ ...form, descricaoNegocio: e.target.value })} placeholder="Ex.: barbearia moderna no centro, especializada em cortes e barba" />
                </div>
                <div>
                  <Label className="text-[12px]">Produtos / serviços</Label>
                  <Textarea className="mt-1" rows={2} value={form.produtosServicos} onChange={(e) => setForm({ ...form, produtosServicos: e.target.value })} placeholder="O que você vende/oferece (separe por vírgula)" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><Label className="text-[12px]">Público-alvo</Label><Input className="mt-1" value={form.publicoAlvo} onChange={(e) => setForm({ ...form, publicoAlvo: e.target.value })} placeholder="Quem é seu cliente ideal" /></div>
                  <div><Label className="text-[12px]">Tom de voz</Label><Input className="mt-1" value={form.tomVoz} onChange={(e) => setForm({ ...form, tomVoz: e.target.value })} placeholder="Ex.: descontraído e próximo" /></div>
                </div>
              </div>
              <div className="flex justify-end mt-5">
                <Button size="sm" onClick={salvarNegocio} disabled={salvando} data-testid="onb-proximo-negocio">
                  {salvando ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null} Próximo
                </Button>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="flex items-center gap-2 mb-1"><Instagram className="w-4 h-4 text-primary" /><span className="text-[14px] font-semibold">Conecte seu Instagram</span></div>
              <p className="text-[12px] text-muted-foreground mb-4">Precisamos da sua conta Instagram Business pra publicar os posts (e a IA aprende do seu feed). Pode conectar agora ou depois.</p>
              {igConectado ? (
                <div className="rounded-box border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-field bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shrink-0"><Instagram className="w-4 h-4 text-white" /></div>
                  <div className="grow min-w-0"><p className="text-[12.5px] font-medium text-emerald-700">Conectado{igStatus?.username ? ` como @${igStatus.username}` : ""}</p><p className="text-[11px] text-emerald-700/70">Tudo certo pra publicar.</p></div>
                  <Check className="w-5 h-5 text-emerald-600 shrink-0" />
                </div>
              ) : (
                <div className="rounded-box border border-base-300 p-4 text-center">
                  <div className="w-11 h-11 rounded-field bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mx-auto mb-2"><Instagram className="w-5 h-5 text-white" /></div>
                  <p className="text-[12.5px] font-medium">Instagram ainda não conectado</p>
                  <p className="text-[11px] text-muted-foreground mb-3">Conecte sua conta Instagram Business pra publicar direto daqui.</p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Button size="sm" onClick={conectarInstagram} disabled={conectando} data-testid="onb-conectar-ig">
                      {conectando ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Instagram className="w-3.5 h-3.5 mr-1.5" />} Conectar Instagram
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => refetchIg()} disabled={igFetching}>
                      {igFetching ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />} Já conectei
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex justify-between mt-5">
                <Button size="sm" variant="ghost" onClick={() => setStep(0)}>Voltar</Button>
                <Button size="sm" onClick={() => setStep(2)}>{igConectado ? "Próximo" : "Pular por enquanto"}</Button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="flex items-center gap-2 mb-1"><ImageIcon className="w-4 h-4 text-primary" /><span className="text-[14px] font-semibold">Sua logo (opcional)</span></div>
              <p className="text-[12px] text-muted-foreground mb-4">A logo é estampada no canto das artes. Pode enviar agora ou depois na aba Marca.</p>
              <div className="flex items-center gap-3 rounded-box border border-base-300 p-3">
                <div className="w-14 h-14 rounded-field bg-base-200 border border-base-300 flex items-center justify-center overflow-hidden shrink-0">
                  {bk?.logoUrl ? <img src={midiaSrc(bk.logoUrl)} alt="logo" className="w-full h-full object-contain" /> : <ImageIcon className="w-6 h-6 text-base-content/30" />}
                </div>
                <div className="grow min-w-0"><p className="text-[12.5px] font-medium">{bk?.logoUrl ? "Logo enviada" : "Nenhuma logo ainda"}</p><p className="text-[11px] text-muted-foreground">PNG com fundo transparente fica melhor.</p></div>
                <label className={`btn btn-sm btn-outline cursor-pointer ${enviandoLogo ? "pointer-events-none opacity-60" : ""}`}>
                  {enviandoLogo ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1.5" />}{bk?.logoUrl ? "Trocar" : "Enviar"}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => { enviarLogo(e.target.files?.[0]); e.currentTarget.value = ""; }} />
                </label>
              </div>
              <div className="flex justify-between mt-5">
                <Button size="sm" variant="ghost" onClick={() => setStep(1)}>Voltar</Button>
                <Button size="sm" onClick={() => setStep(3)}>Próximo</Button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="text-center py-3">
                <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-3"><Check className="w-7 h-7 text-emerald-600" /></div>
                <p className="text-[16px] font-semibold">Tudo pronto!</p>
                <p className="text-[12.5px] text-muted-foreground max-w-[430px] mx-auto mt-1">
                  Seu módulo está configurado{segNome ? ` como ${segNome}` : ""}. Agora é só gerar seu primeiro post — e você ajusta tudo na aba Marca quando quiser.
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-[11px]">
                  <span className={`px-2 py-0.5 rounded-full border ${form.descricaoNegocio ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/25" : "bg-base-200 text-base-content/50 border-base-300"}`}>Negócio ✓</span>
                  <span className={`px-2 py-0.5 rounded-full border ${igConectado ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/25" : "bg-amber-500/10 text-amber-700 border-amber-500/25"}`}>{igConectado ? "Instagram ✓" : "Instagram pendente"}</span>
                  <span className={`px-2 py-0.5 rounded-full border ${bk?.logoUrl ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/25" : "bg-base-200 text-base-content/50 border-base-300"}`}>{bk?.logoUrl ? "Logo ✓" : "Logo opcional"}</span>
                </div>
              </div>
              <div className="flex justify-between mt-2">
                <Button size="sm" variant="ghost" onClick={() => setStep(2)}>Voltar</Button>
                <Button size="sm" onClick={concluir} disabled={salvando} data-testid="onb-concluir">
                  {salvando ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />} Começar a criar posts
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function Instaflix() {
  const [tab, setTab] = useState<Tab>("estudio");
  const { data: bk, isLoading } = useQuery<any>({ queryKey: ["/api/instaflix/brand-kit"] });

  // Onboarding do módulo: na primeira vez (brand kit sem onboarding concluído) o cliente
  // faz o questionário (segmento + negócio) + conecta o Instagram + logo, antes das abas.
  if (isLoading) {
    return <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">Carregando…</div>;
  }
  if (!bk?.onboardingConcluido) {
    return <InstaflixOnboarding />;
  }

  return (
    <div className="h-full flex flex-col" data-testid="page-instaflix">
      {/* Cabeçalho */}
      <div className="px-5 pt-4 pb-3 flex-shrink-0">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-field bg-primary flex items-center justify-center flex-shrink-0">
            <Clapperboard className="w-4 h-4 text-primary-content" />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight">Instaflix</h1>
            <p className="text-[11px] text-muted-foreground">
              Crie, agende e publique posts do Instagram com IA
            </p>
          </div>
        </div>
      </div>

      {/* Abas */}
      <div className="px-5 border-b flex gap-0.5 flex-shrink-0">
        {SUBS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`seg-tab ${tab === t.key ? "seg-tab-active" : ""}`}
              data-testid={`instaflix-tab-${t.key}`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-auto p-5">
        {tab === "estudio" && <EstudioTab />}
        {tab === "marca" && <MarcaTab />}
        {tab === "pilares" && <PilaresTab />}
        {tab === "agenda" && <AgendaTab />}
      </div>
    </div>
  );
}

// ── Campanha de produto (Fase 2, Nível A): foto real + oferta cravada ─────────
function CampanhaForm() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [foto, setFoto] = useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = useState("");
  const [produtoNome, setProdutoNome] = useState("");
  const [ofertaTipo, setOfertaTipo] = useState("desconto_pct");
  const [pct, setPct] = useState("");
  const [de, setDe] = useState("");
  const [por, setPor] = useState("");
  const [preco, setPreco] = useState("");
  const [condicao, setCondicao] = useState("");
  const [cta, setCta] = useState("whatsapp");
  const [briefing, setBriefing] = useState("");
  const [gerando, setGerando] = useState(false);

  function escolherFoto(f?: File | null) {
    if (!f) return;
    setFoto(f);
    setFotoPreview(URL.createObjectURL(f));
  }
  function valorOferta() {
    switch (ofertaTipo) {
      case "desconto_pct": return { pct };
      case "preco_de_por": return { de, por };
      case "preco_fixo": return { preco };
      case "condicao": return { texto: condicao };
      default: return {};
    }
  }

  async function gerar() {
    if (!foto) { toast({ title: "Anexe a foto do produto", variant: "destructive" }); return; }
    if (!produtoNome.trim()) { toast({ title: "Informe o nome do produto", variant: "destructive" }); return; }
    const faltaOferta =
      (ofertaTipo === "desconto_pct" && !(Number(pct) > 0)) ||
      (ofertaTipo === "preco_de_por" && !por.trim()) ||
      (ofertaTipo === "preco_fixo" && !preco.trim()) ||
      (ofertaTipo === "condicao" && !condicao.trim());
    if (faltaOferta) { toast({ title: "Complete a oferta", description: "Preencha o valor da oferta (ou escolha “Sem preço”).", variant: "destructive" }); return; }
    setGerando(true);
    try {
      const fd = new FormData();
      fd.append("file", foto);
      fd.append("produtoNome", produtoNome.trim());
      fd.append("ofertaTipo", ofertaTipo);
      fd.append("ofertaValor", JSON.stringify(valorOferta()));
      if (cta) fd.append("cta", cta);
      if (briefing.trim()) fd.append("briefing", briefing.trim());
      const res = await apiUpload("/api/instaflix/posts/generate-campaign", fd);
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      qc.invalidateQueries({ queryKey: ["/api/instaflix/posts"] });
      toast({ title: "Campanha criada!", description: "A prévia aparece abaixo, aguardando sua aprovação." });
      setProdutoNome(""); setPct(""); setDe(""); setPor(""); setPreco(""); setCondicao(""); setBriefing(""); setFoto(null); setFotoPreview("");
    } catch (e: any) {
      toast({ title: "Erro ao gerar campanha", description: e.message, variant: "destructive" });
    } finally { setGerando(false); }
  }

  return (
    <Card className="p-5">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="flex items-center gap-2 mb-1"><ImageIcon className="w-4 h-4 text-primary" /><span className="text-[13px] font-semibold">Campanha de produto</span></div>
          <p className="text-[12px] text-base-content/55 leading-relaxed mb-3">
            Anexe a foto REAL do produto e defina a oferta. A IA monta a arte com a sua foto + o selo da oferta e escreve a legenda — <b>sem inventar desconto</b>.
          </p>
          <label className="block rounded-box border-2 border-dashed border-base-300 hover:border-primary/40 transition-colors cursor-pointer aspect-[4/5] overflow-hidden">
            {fotoPreview
              ? <img src={fotoPreview} alt="produto" className="w-full h-full object-contain bg-base-200" />
              : <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-base-content/40"><Upload className="w-6 h-6" /><span className="text-[11.5px]">Clique pra anexar a foto</span></div>}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => { escolherFoto(e.target.files?.[0]); e.currentTarget.value = ""; }} data-testid="campanha-foto" />
          </label>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div>
            <Label className="text-[12px]">Nome do produto *</Label>
            <Input className="mt-1" value={produtoNome} onChange={(e) => setProdutoNome(e.target.value)} placeholder="Ex.: Vestido Flora, iPhone 13, Combo Família" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-[12px]">Tipo de oferta</Label>
              <Select value={ofertaTipo} onValueChange={setOfertaTipo}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="desconto_pct">Desconto (%)</SelectItem>
                  <SelectItem value="preco_de_por">De / Por</SelectItem>
                  <SelectItem value="preco_fixo">Preço fixo</SelectItem>
                  <SelectItem value="condicao">Condição (ex.: 3x sem juros)</SelectItem>
                  <SelectItem value="sem_preco">Sem preço (só desejo)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[12px]">Chamada (CTA)</Label>
              <Select value={cta} onValueChange={setCta}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">Chamar no WhatsApp</SelectItem>
                  <SelectItem value="vender_app">Comprar no app</SelectItem>
                  <SelectItem value="agendar">Agendar</SelectItem>
                  <SelectItem value="seguidores">Seguir o perfil</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {ofertaTipo === "desconto_pct" && (
            <div className="max-w-[180px]"><Label className="text-[12px]">Desconto (%)</Label><Input type="number" min={1} max={90} className="mt-1" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="20" /></div>
          )}
          {ofertaTipo === "preco_de_por" && (
            <div className="grid grid-cols-2 gap-3 max-w-[360px]">
              <div><Label className="text-[12px]">De (R$)</Label><Input className="mt-1" value={de} onChange={(e) => setDe(e.target.value)} placeholder="199,90" /></div>
              <div><Label className="text-[12px]">Por (R$)</Label><Input className="mt-1" value={por} onChange={(e) => setPor(e.target.value)} placeholder="149,90" /></div>
            </div>
          )}
          {ofertaTipo === "preco_fixo" && (
            <div className="max-w-[180px]"><Label className="text-[12px]">Preço (R$)</Label><Input className="mt-1" value={preco} onChange={(e) => setPreco(e.target.value)} placeholder="149,90" /></div>
          )}
          {ofertaTipo === "condicao" && (
            <div className="max-w-[340px]"><Label className="text-[12px]">Condição</Label><Input className="mt-1" value={condicao} onChange={(e) => setCondicao(e.target.value)} placeholder="Ex.: 3x sem juros, frete grátis" /></div>
          )}

          <div>
            <Label className="text-[12px]">Observações (opcional)</Label>
            <Textarea className="mt-1" rows={2} maxLength={500} value={briefing} onChange={(e) => setBriefing(e.target.value)} placeholder="Algo que a legenda deve destacar (validade, benefício…)" />
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={gerar} disabled={gerando} data-testid="btn-gerar-campanha">
              {gerando ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
              {gerando ? "Gerando…" : "Gerar campanha"}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ESTÚDIO — gerar post com IA + fila de posts
// ════════════════════════════════════════════════════════════════════════════
function EstudioTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [formato, setFormato] = useState<"carrossel" | "imagem">("carrossel");
  const [numImagens, setNumImagens] = useState(3);
  const [pillarId, setPillarId] = useState<string>("");
  const [objetivo, setObjetivo] = useState("auto");
  const [briefing, setBriefing] = useState("");
  const [gerando, setGerando] = useState(false);
  const [aberto, setAberto] = useState<any | null>(null);
  const [modo, setModo] = useState<"post" | "campanha">("post");
  // Faixa de texto no rodapé das artes: liga/desliga + cor. "" = herda a cor da marca.
  const [faixaAtiva, setFaixaAtiva] = useState(true);
  const [faixaCor, setFaixaCor] = useState("");
  const [inspirarMateriais, setInspirarMateriais] = useState(false);

  const { data: pillars = [] } = useQuery<any[]>({ queryKey: ["/api/instaflix/pillars"] });
  const { data: bk } = useQuery<any>({ queryKey: ["/api/instaflix/brand-kit"] });
  // Cor default da faixa = 1ª cor válida da paleta da marca; fallback = primária do app.
  const corMarca = (Array.isArray(bk?.paletaCores) ? bk.paletaCores : [])
    .find((c: any) => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c)) || "#7c3aed";
  const { data: posts = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/instaflix/posts"],
    // Enquanto houver post gerando/publicando, faz polling pra atualizar o progresso.
    refetchInterval: (query) => {
      const d = query.state.data as any[] | undefined;
      return Array.isArray(d) && d.some((p) => p.status === "gerando" || p.status === "publicando") ? 2000 : false;
    },
  });

  async function gerar() {
    setGerando(true);
    try {
      // O backend cria o post "gerando" e devolve na hora; a IA roda em background.
      await apiRequest("POST", "/api/instaflix/posts/generate", {
        formato,
        numImagens,
        pillarId: pillarId || undefined,
        objetivo: objetivo === "auto" ? undefined : objetivo,
        briefing: briefing.trim() || undefined,
        faixaAtiva,
        faixaCor: faixaAtiva ? (faixaCor || undefined) : undefined,
        inspirarMateriais,
      });
      await qc.invalidateQueries({ queryKey: ["/api/instaflix/posts"] });
      toast({ title: "Gerando post…", description: "A prévia aparece abaixo com o progresso. Pode continuar usando o app." });
    } catch (e: any) {
      toast({ title: "Erro ao iniciar geração", description: e.message, variant: "destructive" });
    } finally {
      setGerando(false);
    }
  }

  return (
    <div className="space-y-5 max-w-[1100px]">
      {/* Alternador de modo: post do dia × campanha de produto */}
      <div className="inline-flex rounded-box border border-base-300 bg-base-100 p-0.5">
        {([["post", "Post do dia", Sparkles], ["campanha", "Campanha de produto", ImageIcon]] as const).map(([m, label, Icon]) => (
          <button
            key={m}
            onClick={() => setModo(m)}
            className={`flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-[10px] transition-colors ${modo === m ? "bg-primary text-primary-content font-medium" : "text-base-content/60 hover:text-base-content"}`}
            data-testid={`modo-${m}`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {modo === "campanha" ? <CampanhaForm /> : (
      /* Painel de geração (2-col) */
      <Card className="p-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-[13px] font-semibold">Gerar novo post</span>
            </div>
            <p className="text-[12px] text-base-content/55 leading-relaxed">
              A IA cria as imagens, a legenda e as hashtags com base na sua Marca e no pilar
              escolhido. Leva cerca de 1 minuto. O rascunho fica aguardando sua aprovação.
            </p>
            <Button size="sm" onClick={gerar} disabled={gerando} className="mt-3" data-testid="btn-gerar-post">
              {gerando ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
              {gerando ? "Gerando..." : "Gerar com IA"}
            </Button>
          </div>

          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label className="text-[12px]">Formato</Label>
              <Select value={formato} onValueChange={(v) => setFormato(v as any)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="carrossel">Carrossel</SelectItem>
                  <SelectItem value="imagem">Imagem única</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[12px]">Nº de imagens</Label>
              <Input
                type="number" min={2} max={10}
                value={numImagens}
                disabled={formato === "imagem"}
                onChange={(e) => setNumImagens(Math.max(2, Math.min(10, Number(e.target.value) || 3)))}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-[12px]">Pilar — sobre o que falar (tema)</Label>
              <Select value={pillarId || "none"} onValueChange={(v) => setPillarId(v === "none" ? "" : v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {pillars.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[12px]">Objetivo / CTA</Label>
              <Select value={objetivo} onValueChange={setObjetivo}>
                <SelectTrigger className="mt-1" data-testid="select-objetivo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OBJETIVOS_POST.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-3">
              <Label className="text-[12px]">Briefing (opcional)</Label>
              <Textarea
                className="mt-1" rows={2}
                value={briefing}
                maxLength={500}
                onChange={(e) => setBriefing(e.target.value)}
                placeholder="Sobre o que é o post? Ex.: divulgar o combo de sexta às 18h com 20% off"
                data-testid="input-briefing"
              />
              <p className="text-[10.5px] text-muted-foreground mt-1">
                Quando preenchido, é o foco principal do post. Deixe vazio pra IA escolher o tema.
              </p>
            </div>

            {/* Faixa de texto no rodapé das artes — liga/desliga + cor (Bruno 2026-07-09) */}
            <div className="sm:col-span-3 rounded-box border border-base-300 bg-base-100 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label className="text-[12px]">Faixa de texto na imagem</Label>
                  <p className="text-[10.5px] text-muted-foreground mt-0.5">
                    A tarja colorida no rodapé onde a frase aparece. Desligada, a frase fica com uma sombra leve.
                  </p>
                </div>
                <Switch checked={faixaAtiva} onCheckedChange={setFaixaAtiva} data-testid="switch-faixa" />
              </div>
              {faixaAtiva && (
                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-base-300">
                  <Label className="text-[12px]">Cor da faixa</Label>
                  <input
                    type="color"
                    value={faixaCor || corMarca}
                    onChange={(e) => setFaixaCor(e.target.value)}
                    className="h-8 w-12 rounded-md border border-base-300 bg-base-100 cursor-pointer p-0.5"
                    data-testid="input-faixa-cor"
                  />
                  <span className="text-[11px] font-mono text-muted-foreground">{(faixaCor || corMarca).toUpperCase()}</span>
                  {faixaCor && (
                    <button
                      type="button"
                      onClick={() => setFaixaCor("")}
                      className="text-[11px] text-primary hover:underline"
                    >
                      usar cor da marca
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Inspirar nos materiais do produto — image-to-image opcional (Bruno 2026-07-09) */}
            <div className="sm:col-span-3 rounded-box border border-base-300 bg-base-100 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label className="text-[12px]">Inspirar nos materiais do produto</Label>
                  <p className="text-[10.5px] text-muted-foreground mt-0.5">
                    A IA usa as imagens que você enviou em <span className="font-medium">Marca › Materiais</span> como referência visual da arte (a IA escolhe as melhores e ignora as ruins). Ligue pra um visual mais fiel ao seu produto; desligado, gera no estilo padrão.
                  </p>
                </div>
                <Switch checked={inspirarMateriais} onCheckedChange={setInspirarMateriais} data-testid="switch-inspirar-materiais" />
              </div>
            </div>
          </div>
        </div>
      </Card>
      )}

      {/* Fila de posts */}
      <div>
        <div className="flex items-center gap-2 mb-2.5">
          <Images className="w-4 h-4 text-base-content/60" />
          <span className="text-[13px] font-semibold">Seus posts</span>
          <span className="text-[11px] text-muted-foreground">({posts.length})</span>
        </div>

        {isLoading ? (
          <div className="text-[12px] text-muted-foreground py-8 text-center">Carregando…</div>
        ) : posts.length === 0 ? (
          <Card className="p-8 text-center">
            <ImageIcon className="w-8 h-8 text-base-content/25 mx-auto mb-2" />
            <p className="text-[13px] font-medium">Nenhum post ainda</p>
            <p className="text-[12px] text-muted-foreground">Clique em “Gerar com IA” para criar o primeiro.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {posts.map((post) => {
              if (post.status === "gerando") return <GeneratingCard key={post.id} post={post} />;
              const capa = Array.isArray(post.midias) && post.midias[0]?.url;
              return (
                <button
                  key={post.id}
                  onClick={() => setAberto(post)}
                  className="text-left rounded-box border border-base-300 overflow-hidden hover:border-primary/40 transition-colors bg-base-100"
                  data-testid={`post-card-${post.id}`}
                >
                  <div className="aspect-[4/5] bg-base-200 relative">
                    {capa ? (
                      <img src={midiaSrc(capa)} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon className="w-6 h-6 text-base-content/25" />
                      </div>
                    )}
                    {Array.isArray(post.midias) && post.midias.length > 1 && (
                      <span className="absolute top-1.5 right-1.5 badge badge-sm bg-black/60 text-white border-0 text-[9px]">
                        <Images className="w-2.5 h-2.5 mr-0.5" />{post.midias.length}
                      </span>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-[11.5px] font-medium truncate">{post.tema || "Sem título"}</p>
                    <span className={`inline-block mt-1 text-[9.5px] px-1.5 py-0.5 rounded border ${STATUS_CLASS[post.status] || "bg-base-200 text-base-content/60 border-base-300"}`}>
                      {STATUS_LABEL[post.status] || post.status}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Passa o post AO VIVO da lista (reflete status atual após ações/polling),
          com fallback pro retrato aberto enquanto a lista não atualiza. */}
      {aberto && (
        <PostPreviewDialog
          post={posts.find((p) => p.id === aberto.id) ?? aberto}
          onClose={() => setAberto(null)}
        />
      )}
    </div>
  );
}

// ── Card da fila enquanto a IA gera o post (status 'gerando') ─────────────────
// FIEL: mostra SÓ o progresso REAL reportado pelo backend (atualizado por polling
// a cada etapa: estratégia → copy → arte → cada imagem). Sem estimativa por tempo
// — a barra reflete o andamento de verdade, mesmo que ande "em degraus".
function GeneratingCard({ post }: { post: any }) {
  const pct = Math.max(0, Math.min(99, typeof post.progresso === "number" ? post.progresso : 0));
  return (
    <div className="rounded-box border border-primary/40 overflow-hidden bg-base-100" data-testid={`post-card-${post.id}`}>
      <div
        className="aspect-[4/5] relative flex flex-col items-center justify-center gap-2"
        style={{ backgroundImage: "var(--gradient-primary)" }}
      >
        <Loader2 className="w-6 h-6 text-white animate-spin" />
        <span className="text-white text-[22px] font-bold tabular-nums leading-none">{pct}%</span>
        <span className="text-white/85 text-[10px] font-medium">Gerando com IA…</span>
        <div className="absolute bottom-0 inset-x-0 h-1.5 bg-black/20">
          <div className="h-full bg-white/90 transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="p-2">
        <p className="text-[11.5px] font-medium truncate">{post.tema || "Gerando post…"}</p>
        <span className="inline-block mt-1 text-[9.5px] px-1.5 py-0.5 rounded border bg-primary/15 text-primary border-primary/30">
          Gerando
        </span>
      </div>
    </div>
  );
}

// ── Preview + ações do post ───────────────────────────────────────────────────
function PostPreviewDialog({ post, onClose }: { post: any; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [legenda, setLegenda] = useState<string>(post.legenda || "");
  const [salvandoLeg, setSalvandoLeg] = useState(false);
  const [imgs, setImgs] = useState<any[]>(
    (Array.isArray(post.midias) ? post.midias : []).slice().sort((a: any, b: any) => (a.ordem ?? 0) - (b.ordem ?? 0)),
  );
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [salvandoOrdem, setSalvandoOrdem] = useState(false);
  // Lightbox como GALERIA: guarda o índice da imagem aberta (não a URL), pra dar
  // pra navegar entre as imagens do carrossel. null = fechado. Bruno 2026-07-07.
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const touchX = useRef<number | null>(null);
  // Avança/volta com wrap (loop) no lightbox.
  const nav = (dir: number) =>
    setLightboxIdx((n) => (n === null || imgs.length === 0 ? n : (n + dir + imgs.length) % imgs.length));

  // Teclado no lightbox: ← → navegam; Esc fecha SÓ o lightbox. O Dialog por baixo
  // é impedido de fechar junto pelo onEscapeKeyDown do DialogContent (quando aberto).
  useEffect(() => {
    if (lightboxIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); nav(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); nav(1); }
      else if (e.key === "Escape") { setLightboxIdx(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIdx, imgs.length]);

  async function salvarOrdem(novo: any[]) {
    setSalvandoOrdem(true);
    try {
      const midiasOrdenadas = novo.map((m, i) => ({ ...m, ordem: i + 1 }));
      const res = await apiRequest("PATCH", `/api/instaflix/posts/${post.id}`, { midias: midiasOrdenadas });
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      qc.invalidateQueries({ queryKey: ["/api/instaflix/posts"] });
    } catch (e: any) {
      toast({ title: "Erro ao salvar ordem", description: e.message, variant: "destructive" });
    } finally {
      setSalvandoOrdem(false);
    }
  }

  function onSoltar(to: number) {
    const from = dragIdx;
    setDragIdx(null);
    if (from === null || from === to) return;
    const novo = imgs.slice();
    const [item] = novo.splice(from, 1);
    novo.splice(to, 0, item);
    setImgs(novo);
    salvarOrdem(novo); // arrastou = salvou a nova ordem
  }

  async function salvarLegenda() {
    setSalvandoLeg(true);
    try {
      const res = await apiRequest("PATCH", `/api/instaflix/posts/${post.id}`, { legenda });
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      qc.invalidateQueries({ queryKey: ["/api/instaflix/posts"] });
      toast({ title: "Legenda salva" });
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    } finally {
      setSalvandoLeg(false);
    }
  }

  async function acao(path: string, sucesso: string) {
    setBusy(true);
    try {
      const res = await apiRequest("POST", `/api/instaflix/posts/${post.id}/${path}`, {});
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      toast({ title: sucesso });
      onClose();
    } catch (e: any) {
      // Não fecha em erro: mantém o diálogo aberto pro usuário ver o status
      // atualizado (ex.: 'falhou') e poder tentar de novo.
      toast({ title: "Não deu certo", description: e.message, variant: "destructive" });
    } finally {
      // Invalida SEMPRE (inclusive no erro) pra o diálogo refletir o status real.
      qc.invalidateQueries({ queryKey: ["/api/instaflix/posts"] });
      setBusy(false);
    }
  }

  async function remover() {
    setBusy(true);
    try {
      await apiRequest("DELETE", `/api/instaflix/posts/${post.id}`);
      qc.invalidateQueries({ queryKey: ["/api/instaflix/posts"] });
      toast({ title: "Post excluído" });
      onClose();
    } catch (e: any) {
      toast({ title: "Erro ao excluir", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-2xl max-h-[88vh] overflow-auto"
        // O lightbox é portalado pro body (irmão do Dialog). Sem isto, um clique
        // nas setas/bolinhas/backdrop dele é visto pelo Radix como "clique fora" e
        // fecha o preview inteiro no pointerdown, antes do onClick navegar. Enquanto
        // o lightbox estiver aberto, bloqueamos o dismiss do Dialog. Bruno 2026-07-07.
        onInteractOutside={(e) => { if (lightboxIdx !== null) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (lightboxIdx !== null) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle className="text-[15px]">{post.tema || "Post"}</DialogTitle>
        </DialogHeader>

        {/* Carrossel: arraste pra reordenar (define a ordem publicada) · clique pra ampliar */}
        {imgs.length > 0 && (
          <div>
            {imgs.length > 1 && (
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-muted-foreground">Arraste pra reordenar · clique pra ampliar</span>
                {salvandoOrdem && (
                  <span className="text-[10.5px] text-muted-foreground flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> salvando ordem…
                  </span>
                )}
              </div>
            )}
            <div className="flex gap-2 overflow-x-auto pb-1">
              {imgs.map((m, i) => (
                <div
                  key={m.url || i}
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onSoltar(i)}
                  onDragEnd={() => setDragIdx(null)}
                  className={`relative flex-shrink-0 cursor-grab active:cursor-grabbing rounded-box transition-opacity ${dragIdx === i ? "opacity-40 ring-2 ring-primary" : ""}`}
                  title="Arraste pra reordenar · clique pra ampliar"
                >
                  <img
                    src={midiaSrc(m.url)}
                    alt={m.textoOverlay || `Imagem ${i + 1}`}
                    draggable={false}
                    role="button"
                    tabIndex={0}
                    onClick={() => setLightboxIdx(i)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setLightboxIdx(i); } }}
                    className="h-64 aspect-[4/5] rounded-box border border-base-300 object-cover cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                  />
                  <span className="absolute top-1 left-1 badge badge-sm bg-black/60 text-white border-0 text-[10px] font-bold">{i + 1}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Legenda (editável, com hashtags no fim) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-[12px]">Legenda</Label>
            <span className="text-[10.5px] text-muted-foreground">{legenda.length}/2200</span>
          </div>
          <Textarea
            value={legenda}
            onChange={(e) => setLegenda(e.target.value)}
            rows={8}
            maxLength={2200}
            className="text-[12.5px] leading-relaxed"
            placeholder={post.status === "gerando" ? "Gerando legenda…" : "Escreva a legenda (inclua as hashtags no fim)…"}
            data-testid="input-legenda"
          />
          {legenda !== (post.legenda || "") && (
            <div className="flex justify-end">
              <Button size="sm" onClick={salvarLegenda} disabled={salvandoLeg} data-testid="btn-salvar-legenda">
                {salvandoLeg ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
                Salvar legenda
              </Button>
            </div>
          )}
        </div>

        {post.errorMessage && (
          <div className="rounded-box bg-red-500/10 border border-red-500/25 p-2.5 text-[12px] text-red-600">
            {post.errorMessage}
          </div>
        )}

        {/* Ações conforme status */}
        <div className="flex flex-wrap gap-2 pt-1">
          {post.status === "aguardando_aprovacao" && (
            <>
              <Button size="sm" onClick={() => acao("aprovar", "Post aprovado e agendado")} disabled={busy}>
                <Check className="w-3.5 h-3.5 mr-1.5" /> Aprovar
              </Button>
              <Button size="sm" variant="outline" onClick={() => acao("reprovar", "Post reprovado")} disabled={busy}>
                <X className="w-3.5 h-3.5 mr-1.5" /> Reprovar
              </Button>
            </>
          )}
          {post.status !== "publicado" && (
            <Button size="sm" variant="outline" onClick={() => acao("publicar", "Publicando…")} disabled={busy} data-testid="btn-publicar">
              {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
              {post.status === "falhou" || post.status === "publicando" ? "Tentar publicar de novo" : "Publicar agora"}
            </Button>
          )}
          {post.igPermalink && (
            <a href={post.igPermalink} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost">
              Ver no Instagram
            </a>
          )}
          <div className="grow" />
          <Button size="sm" variant="ghost" onClick={remover} disabled={busy} className="text-red-600 hover:text-red-700">
            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Excluir
          </Button>
        </div>
        <p className="text-[10.5px] text-muted-foreground">
          Publicar de verdade exige uma URL pública (túnel/infra) que o Instagram alcance — no modo
          local, use um túnel apontando pro app.
        </p>
      </DialogContent>
    </Dialog>

    {/* Lightbox — imagem grande (tamanho da publicação). Portal pro body + z alto +
        pointer-events auto pra ficar ACIMA do Dialog do Radix (que abre em portal e
        trava pointer-events no body — senão o lightbox renderiza ATRÁS do dialog). */}
    {lightboxIdx !== null && imgs[lightboxIdx] && createPortal(
      <div
        className="fixed inset-0 z-[9999] bg-black/85 flex items-center justify-center p-4 select-none"
        style={{ pointerEvents: "auto" }}
        role="dialog"
        aria-modal="true"
        aria-label="Visualizador de imagem"
        onClick={() => setLightboxIdx(null)}
        onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => {
          if (touchX.current === null) return;
          const dx = (e.changedTouches[0]?.clientX ?? 0) - touchX.current;
          touchX.current = null;
          if (imgs.length > 1 && Math.abs(dx) > 40) nav(dx < 0 ? 1 : -1); // arrasta ← → troca
        }}
      >
        <img
          src={midiaSrc(imgs[lightboxIdx].url)}
          alt={imgs[lightboxIdx].textoOverlay || ""}
          onClick={(e) => e.stopPropagation()}
          className="max-w-[92vw] max-h-[92vh] rounded-box object-contain shadow-2xl"
        />

        {/* Fechar */}
        <button
          onClick={() => setLightboxIdx(null)}
          className="absolute top-4 right-4 text-white/80 hover:text-white"
          aria-label="Fechar"
        >
          <X className="w-7 h-7" />
        </button>

        {imgs.length > 1 && (
          <>
            {/* Seta anterior */}
            <button
              onClick={(e) => { e.stopPropagation(); nav(-1); }}
              className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/15 hover:bg-white/30 text-white flex items-center justify-center backdrop-blur-sm transition-colors"
              aria-label="Imagem anterior"
              data-testid="lightbox-prev"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            {/* Seta próxima */}
            <button
              onClick={(e) => { e.stopPropagation(); nav(1); }}
              className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/15 hover:bg-white/30 text-white flex items-center justify-center backdrop-blur-sm transition-colors"
              aria-label="Próxima imagem"
              data-testid="lightbox-next"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
            {/* Contador */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/90 text-[13px] font-medium tabular-nums bg-black/40 px-2.5 py-1 rounded-full">
              {lightboxIdx + 1} / {imgs.length}
            </div>
            {/* Bolinhas (clicáveis) */}
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
              {imgs.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setLightboxIdx(i)}
                  aria-label={`Ir para imagem ${i + 1}`}
                  className={`h-2 rounded-full transition-all ${i === lightboxIdx ? "w-5 bg-white" : "w-2 bg-white/40 hover:bg-white/70"}`}
                />
              ))}
            </div>
          </>
        )}
      </div>,
      document.body,
    )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MARCA — brand kit
// ════════════════════════════════════════════════════════════════════════════
function MarcaTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: bk } = useQuery<any>({ queryKey: ["/api/instaflix/brand-kit"] });
  const { data: segmentos = [] } = useQuery<any[]>({ queryKey: ["/api/instaflix/segmentos"] });
  const [salvandoSeg, setSalvandoSeg] = useState(false);

  // Segmento configura a "cara" que a IA dá às artes (herói, estilo de foto, luz).
  // Salva na hora ao trocar. Bruno 2026-07-09.
  async function salvarSegmento(slug: string) {
    setSalvandoSeg(true);
    try {
      const res = await apiRequest("PUT", "/api/instaflix/brand-kit", { segmento: slug || null });
      await res.json();
      qc.invalidateQueries({ queryKey: ["/api/instaflix/brand-kit"] });
      toast({ title: "Segmento atualizado", description: "A IA vai gerar as artes com a cara desse segmento." });
    } catch (e: any) {
      toast({ title: "Erro ao salvar segmento", description: e.message, variant: "destructive" });
    } finally {
      setSalvandoSeg(false);
    }
  }

  const [saving, setSaving] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [sincronizandoCrm, setSincronizandoCrm] = useState(false);
  const [sincronizandoSite, setSincronizandoSite] = useState(false);
  const [siteInput, setSiteInput] = useState("");

  const [f, setF] = useState<Record<string, string>>({});
  const val = (k: string, fallback: any = "") =>
    f[k] !== undefined ? f[k] : (Array.isArray(fallback) ? fallback.join(", ") : (fallback ?? ""));

  // Upload de logo e materiais (PDF/imagem) que a IA lê.
  const [enviandoLogo, setEnviandoLogo] = useState(false);
  const [enviandoDoc, setEnviandoDoc] = useState(false);
  const [removendoDoc, setRemovendoDoc] = useState<string | null>(null);
  const [extraindoLogo, setExtraindoLogo] = useState<string | null>(null);
  const [candidatosLogo, setCandidatosLogo] = useState<any[] | null>(null);
  const [definindoLogo, setDefinindoLogo] = useState(false);
  const [logoLink, setLogoLink] = useState("");
  const [enviandoLink, setEnviandoLink] = useState(false);
  const [removendoLogo, setRemovendoLogo] = useState<string | null>(null);
  const documentos: any[] = Array.isArray(bk?.documentos) ? bk.documentos : [];
  // Variações da logo (campo novo `logos`); cai na logo única antiga (compat).
  const logos: string[] = (() => {
    const arr = Array.isArray(bk?.logos) ? (bk.logos as any[]).map((l) => l?.url).filter(Boolean) : [];
    if (arr.length) return arr;
    return bk?.logoUrl ? [bk.logoUrl] : [];
  })();

  async function enviarLogo(file?: File | null) {
    if (!file) return;
    setEnviandoLogo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiUpload("/api/instaflix/brand-kit/logo", fd);
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      setF((prev) => { const { logoUrl, ...rest } = prev; return rest; }); // descarta edição manual antiga
      qc.invalidateQueries({ queryKey: ["/api/instaflix/brand-kit"] });
      toast({ title: "Variação adicionada!", description: "A IA escolhe a variação que combina com o fundo de cada arte." });
    } catch (e: any) {
      toast({ title: "Erro ao enviar logo", description: e.message, variant: "destructive" });
    } finally {
      setEnviandoLogo(false);
    }
  }

  async function enviarDocumento(file?: File | null) {
    if (!file) return;
    setEnviandoDoc(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiUpload("/api/instaflix/brand-kit/documentos", fd);
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      qc.invalidateQueries({ queryKey: ["/api/instaflix/brand-kit"] });
      toast({ title: "Material enviado!", description: "A IA leu o conteúdo e já vai usar nas próximas gerações." });
    } catch (e: any) {
      toast({ title: "Erro ao enviar material", description: e.message, variant: "destructive" });
    } finally {
      setEnviandoDoc(false);
    }
  }

  async function removerDocumento(id: string) {
    setRemovendoDoc(id);
    try {
      await apiRequest("DELETE", `/api/instaflix/brand-kit/documentos/${id}`);
      qc.invalidateQueries({ queryKey: ["/api/instaflix/brand-kit"] });
    } catch (e: any) {
      toast({ title: "Erro ao remover", description: e.message, variant: "destructive" });
    } finally {
      setRemovendoDoc(null);
    }
  }

  // Extrai logos de um PDF (rasteriza páginas + remove fundo) → abre o seletor.
  async function extrairLogos(docId: string) {
    setExtraindoLogo(docId);
    setCandidatosLogo(null);
    try {
      const res = await apiRequest("POST", `/api/instaflix/brand-kit/documentos/${docId}/extrair-logos`, {});
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      setCandidatosLogo(Array.isArray(json.candidatos) ? json.candidatos : []);
    } catch (e: any) {
      toast({ title: "Erro ao extrair logos", description: e.message, variant: "destructive" });
    } finally {
      setExtraindoLogo(null);
    }
  }

  // Puxa a logo de um LINK de imagem (ex.: "copiar endereço da imagem" no Google).
  async function enviarLogoLink() {
    const url = logoLink.trim();
    if (!url) return;
    setEnviandoLink(true);
    try {
      const res = await apiRequest("POST", "/api/instaflix/brand-kit/logo/from-url", { url });
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      setLogoLink("");
      setF((prev) => { const { logoUrl, ...rest } = prev; return rest; });
      qc.invalidateQueries({ queryKey: ["/api/instaflix/brand-kit"] });
      toast({ title: "Variação adicionada do link!", description: "Fundo removido — a IA escolhe a variação por arte." });
    } catch (e: any) {
      toast({ title: "Não deu pra importar do link", description: e.message, variant: "destructive" });
    } finally {
      setEnviandoLink(false);
    }
  }

  async function definirLogo(url: string) {
    setDefinindoLogo(true);
    try {
      const res = await apiRequest("POST", "/api/instaflix/brand-kit/logo/definir", { url });
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      setCandidatosLogo(null);
      setF((prev) => { const { logoUrl, ...rest } = prev; return rest; });
      qc.invalidateQueries({ queryKey: ["/api/instaflix/brand-kit"] });
      toast({ title: "Variação adicionada!", description: "A IA escolhe a variação que combina com o fundo de cada arte." });
    } catch (e: any) {
      toast({ title: "Erro ao definir logo", description: e.message, variant: "destructive" });
    } finally {
      setDefinindoLogo(false);
    }
  }

  // Remove uma variação de logo do brand kit.
  async function removerLogo(url: string) {
    setRemovendoLogo(url);
    try {
      const res = await apiRequest("POST", "/api/instaflix/brand-kit/logo/remover", { url });
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      qc.invalidateQueries({ queryKey: ["/api/instaflix/brand-kit"] });
    } catch (e: any) {
      toast({ title: "Erro ao remover variação", description: e.message, variant: "destructive" });
    } finally {
      setRemovendoLogo(null);
    }
  }

  const igInfo = bk?.fontesConhecimento?.instagram;
  const crmInfo = bk?.fontesConhecimento?.crm;

  // Quantos posts o tenant quer analisar no sync (até 100). Lembra a última escolha.
  const [postsLimite, setPostsLimite] = useState(25);
  useEffect(() => {
    if (igInfo?.postsLimite) setPostsLimite(Number(igInfo.postsLimite));
  }, [igInfo?.postsLimite]);

  async function sincronizar() {
    setSincronizando(true);
    try {
      const res = await apiRequest("POST", "/api/instaflix/brand-kit/sync", { limite: postsLimite });
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      setF({}); // descarta edições locais → mostra os campos recém-preenchidos pela sync
      qc.invalidateQueries({ queryKey: ["/api/instaflix/brand-kit"] });
      toast({
        title: "Marca sincronizada do Instagram!",
        description: `${json.postsAnalisados ?? 0} posts analisados${json.igUsername ? ` de @${json.igUsername}` : ""}.`,
      });
    } catch (e: any) {
      toast({ title: "Não deu pra sincronizar", description: e.message, variant: "destructive" });
    } finally {
      setSincronizando(false);
    }
  }

  async function sincronizarCrm() {
    setSincronizandoCrm(true);
    try {
      const res = await apiRequest("POST", "/api/instaflix/brand-kit/sync-crm", {});
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      qc.invalidateQueries({ queryKey: ["/api/instaflix/brand-kit"] });
      toast({
        title: "CRM sincronizado!",
        description: `${json.faqCount ?? 0} dúvidas e ${json.provaSocialCount ?? 0} provas sociais a partir de ${json.mensagensAnalisadas ?? 0} mensagens e ${json.dealsAnalisados ?? 0} negócios.`,
      });
    } catch (e: any) {
      toast({ title: "Não deu pra sincronizar o CRM", description: e.message, variant: "destructive" });
    } finally {
      setSincronizandoCrm(false);
    }
  }

  async function sincronizarSite() {
    const url = (siteInput || bk?.siteUrl || "").trim();
    if (!url) {
      toast({ title: "Informe a URL do site", variant: "destructive" });
      return;
    }
    setSincronizandoSite(true);
    try {
      const res = await apiRequest("POST", "/api/instaflix/brand-kit/sync-site", { url });
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      qc.invalidateQueries({ queryKey: ["/api/instaflix/brand-kit"] });
      if (json.aviso) {
        // no caminho de aviso o servidor NÃO gravou os campos → preserva o que o usuário digitou.
        toast({ title: "Li o site, mas achei pouco", description: json.aviso, variant: "destructive" });
      } else {
        // sucesso: descarta a edição local SÓ dos campos que a análise realmente preencheu
        // (preserva o que o usuário digitou nos campos que o servidor não tocou).
        setF((prev) => {
          const next = { ...prev };
          if (json.produtosServicos !== undefined) delete next.produtosServicos;
          if (json.planosValores !== undefined) delete next.planosValores;
          if (Array.isArray(json.paleta) && json.paleta.length) delete next.paletaCores;
          if (Array.isArray(json.hashtags) && json.hashtags.length) delete next.hashtagsPadrao;
          return next;
        });
        const nPag = Number(json.paginas || 0);
        const info = [
          nPag > 0 ? `${nPag} página${nPag > 1 ? "s" : ""} lida${nPag > 1 ? "s" : ""}` : "",
          json.temPlanos ? "planos captados" : "",
          Array.isArray(json.paleta) && json.paleta.length ? "paleta" : "",
          Array.isArray(json.hashtags) && json.hashtags.length ? "hashtags" : "",
        ].filter(Boolean).join(" · ");
        toast({
          title: "Site analisado!",
          description: [info, json.resumo ? String(json.resumo).slice(0, 100) : ""].filter(Boolean).join(" — "),
        });
      }
    } catch (e: any) {
      toast({ title: "Não deu pra ler o site", description: e.message, variant: "destructive" });
    } finally {
      setSincronizandoSite(false);
    }
  }

  async function salvar() {
    setSaving(true);
    try {
      const toArr = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
      const payload: Record<string, any> = {
        descricaoNegocio: val("descricaoNegocio", bk?.descricaoNegocio),
        produtosServicos: val("produtosServicos", bk?.produtosServicos),
        planosValores: val("planosValores", bk?.planosValores),
        publicoAlvo: val("publicoAlvo", bk?.publicoAlvo),
        tomVoz: val("tomVoz", bk?.tomVoz),
        diretrizes: val("diretrizes", bk?.diretrizes),
        logoUrl: val("logoUrl", bk?.logoUrl),
        paletaCores: toArr(val("paletaCores", bk?.paletaCores)),
        hashtagsPadrao: toArr(val("hashtagsPadrao", bk?.hashtagsPadrao)).map((h) => h.replace(/^#/, "")),
      };
      const res = await apiRequest("PUT", "/api/instaflix/brand-kit", payload);
      await res.json();
      qc.invalidateQueries({ queryKey: ["/api/instaflix/brand-kit"] });
      toast({ title: "Marca salva com sucesso!" });
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function refazerOnboarding() {
    try {
      await apiRequest("PUT", "/api/instaflix/brand-kit", { onboardingConcluido: false });
      qc.invalidateQueries({ queryKey: ["/api/instaflix/brand-kit"] });
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
  }

  return (
    <div className="max-w-[1100px] space-y-4">
      <div className="flex justify-end -mb-1">
        <Button size="sm" variant="ghost" onClick={refazerOnboarding} className="text-[11px] text-muted-foreground h-7">
          <RefreshCw className="w-3 h-3 mr-1.5" /> Refazer configuração inicial
        </Button>
      </div>
      {/* Fontes de dados — a "munição" que a IA usa pra criar conteúdo */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-[13px] font-semibold">Fontes de dados</span>
          <span className="text-[11px] text-muted-foreground">— quanto mais a IA sabe do seu negócio, melhores os posts</span>
        </div>
        <div className="space-y-2.5">
          {/* Instagram */}
          <div className="flex items-center gap-3 flex-wrap rounded-box border border-base-300 p-2.5">
            <div className="w-8 h-8 rounded-field bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
              <Instagram className="w-4 h-4 text-white" />
            </div>
            <div className="grow min-w-0">
              <p className="text-[12.5px] font-medium">Instagram conectado</p>
              <p className="text-[11px] text-muted-foreground">
                {igInfo
                  ? `@${igInfo.igUsername || "conta"} · ${igInfo.syncedPosts ?? 0} posts analisados`
                  : "Aprende voz, temas e hashtags do seu feed."}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Input
                type="number" min={5} max={100} step={5}
                value={postsLimite}
                onChange={(e) => setPostsLimite(Math.max(5, Math.min(100, Number(e.target.value) || 25)))}
                disabled={sincronizando}
                className="h-8 w-16 text-center px-1"
                title="Quantos posts analisar (até 100)"
                data-testid="input-posts-limite"
              />
              <span className="text-[11px] text-muted-foreground">posts</span>
            </div>
            <Button size="sm" variant="outline" onClick={sincronizar} disabled={sincronizando} data-testid="btn-sync-instagram">
              {sincronizando ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
              Sincronizar
            </Button>
          </div>

          {/* CRM */}
          <div className="flex items-center gap-3 flex-wrap rounded-box border border-base-300 p-2.5">
            <div className="w-8 h-8 rounded-field bg-primary flex items-center justify-center flex-shrink-0">
              <Database className="w-4 h-4 text-primary-content" />
            </div>
            <div className="grow min-w-0">
              <p className="text-[12.5px] font-medium">CRM</p>
              <p className="text-[11px] text-muted-foreground">
                {crmInfo
                  ? `${crmInfo.mensagensAnalisadas ?? 0} mensagens · ${crmInfo.dealsAnalisados ?? 0} negócios analisados`
                  : "Dúvidas frequentes dos clientes (das conversas) + prova social dos negócios."}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={sincronizarCrm} disabled={sincronizandoCrm} data-testid="btn-sync-crm">
              {sincronizandoCrm ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Database className="w-3.5 h-3.5 mr-1.5" />}
              Sincronizar
            </Button>
          </div>

          {/* Site */}
          <div className="flex items-center gap-3 flex-wrap rounded-box border border-base-300 p-2.5">
            <div className="w-8 h-8 rounded-field bg-base-200 flex items-center justify-center flex-shrink-0">
              <Globe className="w-4 h-4 text-base-content/70" />
            </div>
            <div className="grow min-w-0">
              <p className="text-[12.5px] font-medium mb-1">Site</p>
              <Input
                value={siteInput || bk?.siteUrl || ""}
                onChange={(e) => setSiteInput(e.target.value)}
                placeholder="https://seusite.com.br"
                className="h-8"
              />
            </div>
            <Button size="sm" variant="outline" onClick={sincronizarSite} disabled={sincronizandoSite} data-testid="btn-sync-site">
              {sincronizandoSite ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Globe className="w-3.5 h-3.5 mr-1.5" />}
              Analisar
            </Button>
          </div>

          {/* Prova visual: o que a IA aprendeu dos clientes (via CRM) */}
          {Array.isArray(bk?.faqClientes) && bk.faqClientes.length > 0 && (
            <div className="rounded-box bg-base-200/40 p-2.5">
              <p className="text-[11px] font-medium text-base-content/70 mb-1.5">Dúvidas frequentes que a IA aprendeu dos seus clientes:</p>
              <div className="flex flex-wrap gap-1">
                {bk.faqClientes.slice(0, 8).map((q: string, i: number) => (
                  <span key={i} className="text-[10.5px] px-2 py-0.5 rounded-field bg-base-100 border border-base-300 text-base-content/70">
                    {q}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Logo + materiais que a IA lê */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Upload className="w-4 h-4 text-primary" />
          <span className="text-[13px] font-semibold">Logo e materiais</span>
          <span className="text-[11px] text-muted-foreground">— a logo entra nas artes; os materiais (PDF/imagem) a IA lê pra aprender do negócio</span>
        </div>
        <div className="space-y-2.5">
          {/* Logo — variações (a IA escolhe a que combina com o fundo de cada arte) */}
          <div className="rounded-box border border-base-300 p-2.5">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="w-8 h-8 rounded-field bg-primary/10 flex items-center justify-center flex-shrink-0">
                <ImageIcon className="w-4 h-4 text-primary" />
              </div>
              <div className="grow min-w-0">
                <p className="text-[12.5px] font-medium">Logo da marca — variações</p>
                <p className="text-[11px] text-muted-foreground">
                  Envie 1 ou mais versões (ex.: uma clara e uma escura). A IA escolhe a que combina com o fundo de cada arte e o melhor canto.
                </p>
              </div>
              <label className={`btn btn-sm btn-outline cursor-pointer ${enviandoLogo ? "pointer-events-none opacity-60" : ""}`} data-testid="btn-upload-logo">
                {enviandoLogo ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1.5" />}
                Adicionar variação
                <input type="file" accept="image/*" className="hidden" disabled={enviandoLogo}
                  onChange={(e) => { enviarLogo(e.target.files?.[0]); e.currentTarget.value = ""; }} />
              </label>
            </div>

            {/* Galeria de variações (fundo xadrez = transparência) */}
            {logos.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {logos.map((url, i) => (
                  <div
                    key={url}
                    className="relative group w-16 h-16 rounded-field border border-base-300 overflow-hidden flex-shrink-0"
                    style={{
                      backgroundImage:
                        "linear-gradient(45deg,#8881 25%,transparent 25%),linear-gradient(-45deg,#8881 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#8881 75%),linear-gradient(-45deg,transparent 75%,#8881 75%)",
                      backgroundSize: "12px 12px",
                      backgroundPosition: "0 0,0 6px,6px -6px,-6px 0",
                    }}
                    title={i === 0 ? "Variação principal" : `Variação ${i + 1}`}
                    data-testid={`logo-variacao-${i}`}
                  >
                    <img src={midiaSrc(url)} alt="" className="w-full h-full object-contain p-1" />
                    <button
                      onClick={() => removerLogo(url)}
                      disabled={removendoLogo === url}
                      className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remover variação"
                      data-testid={`btn-remover-logo-${i}`}
                    >
                      {removendoLogo === url ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <X className="w-2.5 h-2.5" />}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Puxar do link (ex.: Google Imagens → copiar endereço da imagem) */}
            <div className="mt-2.5 flex items-center gap-2">
              <Input
                value={logoLink}
                onChange={(e) => setLogoLink(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") enviarLogoLink(); }}
                placeholder="ou cole o link de uma imagem (Google → botão direito → copiar endereço da imagem)"
                className="h-8 text-[11.5px]"
                disabled={enviandoLink}
                data-testid="input-logo-link"
              />
              <Button size="sm" variant="outline" onClick={enviarLogoLink} disabled={enviandoLink || !logoLink.trim()} className="shrink-0" data-testid="btn-logo-link">
                {enviandoLink ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Globe className="w-3.5 h-3.5 mr-1.5" />}
                Usar link
              </Button>
            </div>
          </div>

          {/* Materiais */}
          <div className="rounded-box border border-base-300 p-2.5">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="w-8 h-8 rounded-field bg-primary/10 flex items-center justify-center flex-shrink-0">
                <FileText className="w-4 h-4 text-primary" />
              </div>
              <div className="grow min-w-0">
                <p className="text-[12.5px] font-medium">Materiais do negócio</p>
                <p className="text-[11px] text-muted-foreground">Cardápio, tabela de preços, catálogo, panfleto… PDF ou imagem. A IA extrai o conteúdo.</p>
              </div>
              <label className={`btn btn-sm btn-outline cursor-pointer ${enviandoDoc ? "pointer-events-none opacity-60" : ""}`} data-testid="btn-upload-material">
                {enviandoDoc ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1.5" />}
                Adicionar
                <input type="file" accept=".pdf,image/*" className="hidden" disabled={enviandoDoc}
                  onChange={(e) => { enviarDocumento(e.target.files?.[0]); e.currentTarget.value = ""; }} />
              </label>
            </div>
            {enviandoDoc && (
              <p className="text-[11px] text-primary mt-2 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> Lendo o material com IA…
              </p>
            )}
            {documentos.length > 0 && (
              <div className="mt-2.5 space-y-1.5">
                {documentos.map((d) => (
                  <div key={d.id} className="flex items-start gap-2 rounded-field bg-base-200/40 p-2">
                    {d.tipo === "imagem"
                      ? <img src={midiaSrc(d.url)} alt="" className="w-9 h-9 rounded object-cover border border-base-300 flex-shrink-0" />
                      : <div className="w-9 h-9 rounded bg-base-100 border border-base-300 flex items-center justify-center flex-shrink-0"><FileText className="w-4 h-4 text-base-content/50" /></div>}
                    <div className="grow min-w-0">
                      <p className="text-[11.5px] font-medium truncate">{d.nome}</p>
                      {d.resumo && <p className="text-[10.5px] text-muted-foreground line-clamp-2">{d.resumo}</p>}
                    </div>
                    {d.tipo === "pdf" && (
                      <button onClick={() => extrairLogos(d.id)} disabled={extraindoLogo === d.id}
                        className="text-[10.5px] px-2 py-1 rounded-field border border-primary/30 text-primary hover:bg-primary/10 shrink-0 inline-flex items-center gap-1 whitespace-nowrap"
                        title="Extrair as logos deste PDF (fundo removido)" data-testid={`btn-extrair-logo-${d.id}`}>
                        {extraindoLogo === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImageIcon className="w-3 h-3" />}
                        Extrair logo
                      </button>
                    )}
                    <button onClick={() => removerDocumento(d.id)} disabled={removendoDoc === d.id}
                      className="text-base-content/40 hover:text-red-600 shrink-0 mt-0.5" title="Remover">
                      {removendoDoc === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Seletor de logo extraída do PDF */}
      {candidatosLogo !== null && (
        <Dialog open onOpenChange={(o) => !o && setCandidatosLogo(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="text-[15px]">Adicionar variação de logo</DialogTitle></DialogHeader>
            {candidatosLogo.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground py-4 text-center leading-relaxed">
                Não consegui isolar uma logo desse PDF (provável logo sobre fundo colorido/foto, ou vetorial).
                Salve a logo que você quer como <b>PNG</b> e use “Adicionar variação” — o fundo é removido automaticamente.
              </p>
            ) : (
              <>
                <p className="text-[12px] text-muted-foreground">
                  Clique na logo que ficou melhor — o fundo já foi removido. A marcada como
                  <b className="text-primary"> recomendada</b> saiu de um fundo escuro, então o contorno branco fica intacto.
                </p>
                <div className="grid grid-cols-3 gap-2.5 max-h-[58vh] overflow-auto pt-1">
                  {candidatosLogo.map((c, i) => (
                    <button
                      key={i}
                      onClick={() => definirLogo(c.url)}
                      disabled={definindoLogo}
                      title={`Página ${c.pagina} · ${c.width}×${c.height}${c.fundo ? ` · fundo ${c.fundo}` : ""}`}
                      data-testid={`logo-candidato-${i}`}
                      className={`relative rounded-box border p-1.5 transition-colors disabled:opacity-50 ${c.recomendado ? "border-primary ring-1 ring-primary/40" : "border-base-300 hover:border-primary"}`}
                      style={{
                        backgroundImage:
                          "linear-gradient(45deg,#8881 25%,transparent 25%),linear-gradient(-45deg,#8881 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#8881 75%),linear-gradient(-45deg,transparent 75%,#8881 75%)",
                        backgroundSize: "14px 14px",
                        backgroundPosition: "0 0,0 7px,7px -7px,-7px 0",
                      }}
                    >
                      {c.recomendado && (
                        <span className="absolute top-1 left-1 z-10 text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-primary text-primary-content">
                          Recomendada
                        </span>
                      )}
                      <img src={midiaSrc(c.url)} alt="" className="w-full h-20 object-contain" />
                    </button>
                  ))}
                </div>
                {definindoLogo && (
                  <p className="text-[11px] text-primary flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Definindo…</p>
                )}
              </>
            )}
          </DialogContent>
        </Dialog>
      )}

      <Card className="p-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2 mb-1">
              <Palette className="w-4 h-4 text-base-content/60" />
              <span className="text-[13px] font-semibold">Identidade da marca</span>
            </div>
            <p className="text-[12px] text-base-content/55 leading-relaxed">
              É o “cérebro” que alimenta a IA. As fontes acima preenchem isto sozinhas
              (Instagram, CRM, site) — e você pode refinar à mão.
            </p>
            <Button size="sm" onClick={salvar} disabled={saving} className="mt-3">
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>

          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Label className="text-[12px]">Segmento do negócio</Label>
              <Select value={bk?.segmento || "generico"} onValueChange={salvarSegmento} disabled={salvandoSeg}>
                <SelectTrigger className="mt-1" data-testid="select-segmento"><SelectValue placeholder="Escolha o segmento" /></SelectTrigger>
                <SelectContent>
                  {(Array.isArray(segmentos) ? segmentos : []).map((s) => (
                    <SelectItem key={s.slug} value={s.slug}>{s.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10.5px] text-muted-foreground mt-1">
                Define a “cara” das artes: o que é destaque na imagem, o estilo de foto e a luz. Ex.: SaaS mostra tela; moda, modelo; academia, treino.
              </p>
            </div>
            <div className="sm:col-span-2">
              <Label className="text-[12px]">O que o negócio faz</Label>
              <Textarea className="mt-1" rows={2} value={val("descricaoNegocio", bk?.descricaoNegocio)}
                onChange={(e) => setF({ ...f, descricaoNegocio: e.target.value })}
                placeholder="Ex.: o que sua empresa faz, vende ou oferece" />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-[12px]">Produtos / serviços</Label>
              <Textarea className="mt-1" rows={2} value={val("produtosServicos", bk?.produtosServicos)}
                onChange={(e) => setF({ ...f, produtosServicos: e.target.value })}
                placeholder="O que você quer divulgar (produtos, serviços, planos). A IA também tenta preencher isso pelo site." />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-[12px]">Planos e valores <span className="text-muted-foreground font-normal">(opcional)</span></Label>
              <Textarea className="mt-1" rows={3} value={val("planosValores", bk?.planosValores)}
                onChange={(e) => setF({ ...f, planosValores: e.target.value })}
                placeholder={"Planos, pacotes e PREÇOS REAIS. Ex.: Básico R$ 49/mês; Pro R$ 99/mês; Enterprise sob consulta."} />
              <p className="text-[10.5px] text-muted-foreground mt-1">
                Só o que for REAL. A IA pode apresentar estes preços/planos nas artes — e nunca inventa outros. A busca do site preenche isso sozinha quando encontra.
              </p>
            </div>
            <div>
              <Label className="text-[12px]">Público-alvo</Label>
              <Input className="mt-1" value={val("publicoAlvo", bk?.publicoAlvo)}
                onChange={(e) => setF({ ...f, publicoAlvo: e.target.value })}
                placeholder="Ex.: quem é seu cliente ideal" />
            </div>
            <div>
              <Label className="text-[12px]">Tom de voz</Label>
              <Input className="mt-1" value={val("tomVoz", bk?.tomVoz)}
                onChange={(e) => setF({ ...f, tomVoz: e.target.value })}
                placeholder="Ex.: profissional, próximo, direto" />
            </div>
            <div>
              <Label className="text-[12px]">Paleta de cores (hex, separado por vírgula)</Label>
              <Input className="mt-1" value={val("paletaCores", bk?.paletaCores)}
                onChange={(e) => setF({ ...f, paletaCores: e.target.value })}
                placeholder="#7c3aed, #0a0e14, #ffffff" />
            </div>
            <div>
              <Label className="text-[12px]">Hashtags padrão</Label>
              <Input className="mt-1" value={val("hashtagsPadrao", bk?.hashtagsPadrao)}
                onChange={(e) => setF({ ...f, hashtagsPadrao: e.target.value })}
                placeholder="suamarca, seusegmento" />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-[12px]">Diretrizes (o que fazer / evitar)</Label>
              <Textarea className="mt-1" rows={2} value={val("diretrizes", bk?.diretrizes)}
                onChange={(e) => setF({ ...f, diretrizes: e.target.value })}
                placeholder="Ex.: sempre incluir CTA; nunca prometer resultado garantido" />
            </div>
            {/* Campo "URL do logo" removido (Bruno 2026-07-07): a logo vem do
                upload em "Materiais da marca" (brand-kit/logo → bk.logoUrl). */}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PILARES
// ════════════════════════════════════════════════════════════════════════════
function PilaresTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: pillars = [] } = useQuery<any[]>({ queryKey: ["/api/instaflix/pillars"] });
  const [novo, setNovo] = useState({ nome: "", objetivo: "autoridade", descricao: "", promptGuia: "" });
  const [saving, setSaving] = useState(false);

  async function criar() {
    if (!novo.nome.trim()) return;
    setSaving(true);
    try {
      await apiRequest("POST", "/api/instaflix/pillars", novo);
      qc.invalidateQueries({ queryKey: ["/api/instaflix/pillars"] });
      setNovo({ nome: "", objetivo: "autoridade", descricao: "", promptGuia: "" });
      toast({ title: "Pilar criado" });
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function excluir(id: string) {
    await apiRequest("DELETE", `/api/instaflix/pillars/${id}`);
    qc.invalidateQueries({ queryKey: ["/api/instaflix/pillars"] });
  }

  const [sugestoes, setSugestoes] = useState<any[]>([]);
  const [sugerindo, setSugerindo] = useState(false);
  const [adicionandoIdx, setAdicionandoIdx] = useState<number | null>(null);

  async function sugerir() {
    setSugerindo(true);
    try {
      const res = await apiRequest("POST", "/api/instaflix/pillars/suggest", {});
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      setSugestoes(Array.isArray(json.pilares) ? json.pilares : []);
      if (!json.pilares?.length) toast({ title: "A IA não retornou sugestões", description: "Preencha a Marca (Sincronizar) e tente de novo." });
    } catch (e: any) {
      toast({ title: "Erro ao sugerir", description: e.message, variant: "destructive" });
    } finally {
      setSugerindo(false);
    }
  }

  async function adicionarSugestao(s: any, idx: number) {
    setAdicionandoIdx(idx);
    try {
      await apiRequest("POST", "/api/instaflix/pillars", s);
      qc.invalidateQueries({ queryKey: ["/api/instaflix/pillars"] });
      setSugestoes((arr) => arr.filter((_, i) => i !== idx));
      toast({ title: `Pilar "${s.nome}" adicionado` });
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally {
      setAdicionandoIdx(null);
    }
  }

  return (
    <div className="max-w-[1100px] space-y-5">
      {/* Sugestões da IA — pilares em 1 clique */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-[13px] font-semibold">Sugestões da IA</span>
            <span className="text-[11px] text-muted-foreground">pilares sob medida pro seu negócio</span>
          </div>
          <Button size="sm" variant="outline" onClick={sugerir} disabled={sugerindo} data-testid="btn-sugerir-pilares">
            {sugerindo ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
            {sugerindo ? "Pensando..." : "Sugerir pilares"}
          </Button>
        </div>
        {sugestoes.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
            {sugestoes.map((s, i) => (
              <div key={i} className="rounded-box border border-base-300 p-3 flex items-start gap-2">
                <div className="grow min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[12.5px] font-semibold">{s.nome}</span>
                    <Badge variant="outline" className="text-[9.5px]">{s.objetivo}</Badge>
                  </div>
                  {s.descricao && <p className="text-[11px] text-muted-foreground mt-0.5">{s.descricao}</p>}
                </div>
                <Button size="icon" onClick={() => adicionarSugestao(s, i)} disabled={adicionandoIdx === i} className="h-7 w-7 shrink-0" title="Adicionar pilar">
                  {adicionandoIdx === i ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Criar + listar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Novo pilar */}
      <Card className="p-4 lg:col-span-1 h-fit">
        <div className="flex items-center gap-2 mb-3">
          <Plus className="w-4 h-4 text-primary" />
          <span className="text-[13px] font-semibold">Novo pilar</span>
        </div>
        <div className="space-y-3">
          <div>
            <Label className="text-[12px]">Nome</Label>
            <Input className="mt-1" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} placeholder="Educativo" />
          </div>
          <div>
            <Label className="text-[12px]">Tom padrão</Label>
            <Select value={novo.objetivo} onValueChange={(v) => setNovo({ ...novo, objetivo: v })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="autoridade">Autoridade</SelectItem>
                <SelectItem value="vendas">Vendas</SelectItem>
                <SelectItem value="engajamento">Engajamento</SelectItem>
                <SelectItem value="bastidores">Bastidores</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10.5px] text-muted-foreground mt-1">Usado quando o Estilo do post está em “Automático”.</p>
          </div>
          <div>
            <Label className="text-[12px]">Descrição</Label>
            <Input className="mt-1" value={novo.descricao} onChange={(e) => setNovo({ ...novo, descricao: e.target.value })} />
          </div>
          <div>
            <Label className="text-[12px]">Direção pra IA</Label>
            <Textarea className="mt-1" rows={2} value={novo.promptGuia} onChange={(e) => setNovo({ ...novo, promptGuia: e.target.value })} placeholder="Ex.: dicas práticas rápidas, tom leve" />
          </div>
          <Button size="sm" onClick={criar} disabled={saving || !novo.nome.trim()} className="w-full">
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Adicionar
          </Button>
        </div>
      </Card>

      {/* Lista */}
      <div className="lg:col-span-2 space-y-2.5">
        {pillars.length === 0 ? (
          <Card className="p-8 text-center text-[12px] text-muted-foreground">
            Nenhum pilar. Crie temas-guia (Educativo, Promoção…) pra IA rotacionar.
          </Card>
        ) : pillars.map((p) => (
          <Card key={p.id} className="p-3.5 flex items-start gap-3">
            <div className="grow min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold">{p.nome}</span>
                <Badge variant="outline" className="text-[10px]">tom: {p.objetivo}</Badge>
              </div>
              {p.descricao && <p className="text-[12px] text-muted-foreground mt-0.5">{p.descricao}</p>}
              {p.promptGuia && <p className="text-[11px] text-base-content/50 mt-1 italic">“{p.promptGuia}”</p>}
            </div>
            <Button size="icon" variant="ghost" onClick={() => excluir(p.id)} className="text-red-600 hover:text-red-700 h-7 w-7">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </Card>
        ))}
      </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// AGENDA — regras
// ════════════════════════════════════════════════════════════════════════════
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// ── Helpers de data/hora (fuso LOCAL do usuário ↔ ISO/UTC do banco) ───────────
// O banco guarda scheduledAt em UTC. O DateTimeLocalPicker trabalha com o horário
// de parede LOCAL ("YYYY-MM-DDTHH:MM"). Convertemos nos dois sentidos.
function isoParaInputLocal(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function inputLocalParaIso(local: string): string {
  if (!local) return "";
  const d = new Date(local); // sem fuso + com hora = interpretado como LOCAL
  return isNaN(d.getTime()) ? "" : d.toISOString();
}
function fmtDataHoraBR(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
// Atalho hoje/amanhã + hora fixa → input local "YYYY-MM-DDTHH:MM".
function presetLocal(offsetDias: number, hhmm: string): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDias);
  const [h, m] = hhmm.split(":");
  d.setHours(Number(h), Number(m), 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const CHIP = "text-[10.5px] px-2 py-1 rounded-field bg-base-200 hover:bg-primary/15 hover:text-primary border border-transparent hover:border-primary/20 transition-colors";

// ── Card de UM post agendável: miniatura + data/hora + ação ───────────────────
function AgendarCard({ post }: { post: any }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dt, setDt] = useState<string>(isoParaInputLocal(post.scheduledAt));
  const [busy, setBusy] = useState(false);

  // Re-sincroniza se o post mudar no servidor (polling/refresh).
  useEffect(() => { setDt(isoParaInputLocal(post.scheduledAt)); }, [post.scheduledAt]);

  const capa = Array.isArray(post.midias) && post.midias[0]?.url;
  const jaAgendado = post.status === "agendado";
  const alterou = dt !== isoParaInputLocal(post.scheduledAt);

  async function agendar() {
    const iso = inputLocalParaIso(dt);
    if (!iso) { toast({ title: "Escolha a data e a hora", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const res = await apiRequest("POST", `/api/instaflix/posts/${post.id}/agendar`, { scheduledAt: iso });
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      qc.invalidateQueries({ queryKey: ["/api/instaflix/posts"] });
      const passou = new Date(iso).getTime() <= Date.now();
      toast({
        title: jaAgendado ? "Reagendado!" : "Aprovado e agendado!",
        description: passou ? "O horário já passou — vai publicar em instantes." : `Publica em ${fmtDataHoraBR(iso)}.`,
      });
    } catch (e: any) {
      toast({ title: "Erro ao agendar", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function cancelar() {
    setBusy(true);
    try {
      const res = await apiRequest("POST", `/api/instaflix/posts/${post.id}/desagendar`, {});
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      qc.invalidateQueries({ queryKey: ["/api/instaflix/posts"] });
      toast({ title: "Agendamento cancelado", description: "Voltou pra aguardando aprovação." });
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  }

  return (
    <Card className="p-3 flex items-start gap-3" data-testid={`agendar-card-${post.id}`}>
      <div className="w-16 h-20 rounded-box bg-base-200 overflow-hidden shrink-0 border border-base-300">
        {capa
          ? <img src={midiaSrc(capa)} alt="" className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-5 h-5 text-base-content/25" /></div>}
      </div>
      <div className="grow min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12.5px] font-medium truncate max-w-[260px]">{post.tema || "Post"}</span>
          <span className={`text-[9.5px] px-1.5 py-0.5 rounded border ${STATUS_CLASS[post.status] || "bg-base-200 text-base-content/60 border-base-300"}`}>
            {STATUS_LABEL[post.status] || post.status}
          </span>
          {Array.isArray(post.midias) && post.midias.length > 1 && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5"><Images className="w-3 h-3" />{post.midias.length}</span>
          )}
        </div>
        {jaAgendado && post.scheduledAt && (
          <p className="text-[11px] text-emerald-600 mt-0.5 flex items-center gap-1">
            <CalendarClock className="w-3 h-3" /> Publica em {fmtDataHoraBR(post.scheduledAt)}
          </p>
        )}

        <div className="mt-2 max-w-[380px]">
          <DateTimeLocalPicker value={dt} onChange={setDt} data-testid={`agendar-dt-${post.id}`} />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <button type="button" className={CHIP} onClick={() => setDt(presetLocal(0, "18:00"))}>Hoje 18h</button>
          <button type="button" className={CHIP} onClick={() => setDt(presetLocal(1, "09:00"))}>Amanhã 9h</button>
          <button type="button" className={CHIP} onClick={() => setDt(presetLocal(1, "18:00"))}>Amanhã 18h</button>
          <div className="grow" />
          {jaAgendado && (
            <Button size="sm" variant="ghost" onClick={cancelar} disabled={busy} className="text-red-600 hover:text-red-700">
              <X className="w-3.5 h-3.5 mr-1" /> Cancelar
            </Button>
          )}
          <Button size="sm" onClick={agendar} disabled={busy || !dt || (jaAgendado && !alterou)} data-testid={`btn-agendar-${post.id}`}>
            {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
            {jaAgendado ? (alterou ? "Reagendar" : "Agendado") : "Aprovar e agendar"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function AgendaTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Posts agendáveis: aprovados/agendados. Poll enquanto algo estiver publicando.
  const { data: posts = [], isLoading: loadingPosts } = useQuery<any[]>({
    queryKey: ["/api/instaflix/posts"],
    refetchInterval: (query) => {
      const d = query.state.data as any[] | undefined;
      return Array.isArray(d) && d.some((p) => p.status === "publicando") ? 3000 : false;
    },
  });
  const agendaveis = (Array.isArray(posts) ? posts : []).filter(
    (p) => p.status === "aguardando_aprovacao" || p.status === "agendado",
  );

  // Regras de geração automática (recorrente) — seção recolhível.
  const { data: rules = [] } = useQuery<any[]>({ queryKey: ["/api/instaflix/rules"] });
  const [regrasAbertas, setRegrasAbertas] = useState(false);
  const [novo, setNovo] = useState<any>({
    nome: "", formato: "carrossel", numImagens: 3, approvalMode: "requer_aprovacao",
    diasSemana: [] as number[], horarios: "09:00",
  });
  const [saving, setSaving] = useState(false);

  function toggleDia(d: number) {
    setNovo((n: any) => ({
      ...n,
      diasSemana: n.diasSemana.includes(d) ? n.diasSemana.filter((x: number) => x !== d) : [...n.diasSemana, d],
    }));
  }

  async function criar() {
    if (!novo.nome.trim()) return;
    setSaving(true);
    try {
      await apiRequest("POST", "/api/instaflix/rules", {
        ...novo,
        horarios: String(novo.horarios).split(/[,\s]+/).filter(Boolean),
      });
      qc.invalidateQueries({ queryKey: ["/api/instaflix/rules"] });
      setNovo({ nome: "", formato: "carrossel", numImagens: 3, approvalMode: "requer_aprovacao", diasSemana: [], horarios: "09:00" });
      toast({ title: "Regra criada" });
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function excluir(id: string) {
    await apiRequest("DELETE", `/api/instaflix/rules/${id}`);
    qc.invalidateQueries({ queryKey: ["/api/instaflix/rules"] });
  }

  return (
    <div className="max-w-[1100px] space-y-4">
      {/* Publicador automático está DESLIGADO (RECORRENTES_ATIVOS=false). Banner honesto. */}
      <div className="rounded-box bg-amber-500/10 border border-amber-500/25 px-3.5 py-2.5 text-[12px] text-amber-700 flex items-start gap-2">
        <CalendarClock className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          Defina a data e a hora de cada post aprovado. <b>A publicação automática no horário está
          desligada por ora</b> (fluxo manual) — por isso, quando chegar a hora, publique pelo botão
          “Publicar agora” dentro do post. Dá pra religar a publicação automática quando você quiser.
        </span>
      </div>

      {/* ── SEÇÃO 1 — Agendar publicações (foco) ── */}
      <div>
        <div className="flex items-center gap-2 mb-2.5">
          <CalendarClock className="w-4 h-4 text-primary" />
          <span className="text-[13px] font-semibold">Agendar publicações</span>
          <span className="text-[11px] text-muted-foreground">({agendaveis.length})</span>
        </div>
        {loadingPosts ? (
          <div className="text-[12px] text-muted-foreground py-8 text-center">Carregando…</div>
        ) : agendaveis.length === 0 ? (
          <Card className="p-8 text-center">
            <CalendarClock className="w-8 h-8 text-base-content/25 mx-auto mb-2" />
            <p className="text-[13px] font-medium">Nada pra agendar ainda</p>
            <p className="text-[12px] text-muted-foreground">Gere um post no Estúdio e aprove — ele aparece aqui pra você escolher a data e a hora.</p>
          </Card>
        ) : (
          <div className="space-y-2.5">
            {agendaveis.map((p) => <AgendarCard key={p.id} post={p} />)}
          </div>
        )}
      </div>

      {/* ── SEÇÃO 2 — Geração automática recorrente (recolhível) ── */}
      <Card className="p-0 overflow-hidden">
        <button
          type="button"
          onClick={() => setRegrasAbertas((o) => !o)}
          className="w-full flex items-center gap-2 px-4 py-3 hover:bg-base-200/40 transition-colors"
          data-testid="toggle-regras"
        >
          <RefreshCw className="w-4 h-4 text-base-content/60" />
          <span className="text-[13px] font-semibold">Geração automática (recorrente)</span>
          <span className="text-[11px] text-muted-foreground">{rules.length ? `${rules.length} regra(s)` : "opcional"}</span>
          <div className="grow" />
          <ChevronDown className={`w-4 h-4 text-base-content/50 transition-transform ${regrasAbertas ? "rotate-180" : ""}`} />
        </button>

        {regrasAbertas && (
          <div className="border-t border-base-300 p-4">
            <p className="text-[11.5px] text-muted-foreground mb-3">
              Deixe a IA gerar rascunhos sozinha em certos dias/horários. Com <b>“Revisar antes”</b> eles
              caem na lista de agendar acima pra você aprovar; com <b>“Publicar automático”</b> já entram na fila.
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Nova regra */}
              <Card className="p-4 lg:col-span-1 h-fit">
                <div className="flex items-center gap-2 mb-3">
                  <Plus className="w-4 h-4 text-primary" />
                  <span className="text-[13px] font-semibold">Nova regra</span>
                </div>
                <div className="space-y-3">
                  <div>
                    <Label className="text-[12px]">Nome</Label>
                    <Input className="mt-1" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} placeholder="Posts da semana" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[12px]">Formato</Label>
                      <Select value={novo.formato} onValueChange={(v) => setNovo({ ...novo, formato: v })}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="carrossel">Carrossel</SelectItem>
                          <SelectItem value="imagem">Imagem</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[12px]">Nº imagens</Label>
                      <Input type="number" min={2} max={10} className="mt-1" value={novo.numImagens}
                        onChange={(e) => setNovo({ ...novo, numImagens: Number(e.target.value) || 3 })} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-[12px]">Dias da semana</Label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {DIAS.map((d, i) => (
                        <button key={i} onClick={() => toggleDia(i)} type="button"
                          className={`text-[11px] px-2 py-1 rounded-field border transition-colors ${
                            novo.diasSemana.includes(i)
                              ? "bg-primary text-primary-content border-primary"
                              : "bg-base-100 border-base-300 text-base-content/60 hover:border-primary/40"
                          }`}>
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-[12px]">Horários (ex.: 09:00, 18:00)</Label>
                    <Input className="mt-1" value={novo.horarios} onChange={(e) => setNovo({ ...novo, horarios: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-[12px]">Aprovação</Label>
                    <Select value={novo.approvalMode} onValueChange={(v) => setNovo({ ...novo, approvalMode: v })}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="requer_aprovacao">Revisar antes (recomendado)</SelectItem>
                        <SelectItem value="auto_post">Publicar automático</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button size="sm" onClick={criar} disabled={saving || !novo.nome.trim()} className="w-full">
                    <Plus className="w-3.5 h-3.5 mr-1.5" /> Adicionar
                  </Button>
                </div>
              </Card>

              {/* Lista de regras */}
              <div className="lg:col-span-2 space-y-2.5">
                {rules.length === 0 ? (
                  <Card className="p-8 text-center text-[12px] text-muted-foreground">
                    Nenhuma regra de geração automática ainda.
                  </Card>
                ) : rules.map((r) => (
                  <Card key={r.id} className="p-3.5 flex items-start gap-3">
                    <div className="grow min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold">{r.nome}</span>
                        <Badge variant="outline" className="text-[10px]">{r.formato}</Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {r.approvalMode === "auto_post" ? "Auto" : "Revisar"}
                        </Badge>
                      </div>
                      <p className="text-[11.5px] text-muted-foreground mt-0.5">
                        {(Array.isArray(r.diasSemana) ? r.diasSemana : []).map((d: number) => DIAS[d]).join(", ") || "Sem dias"}
                        {" · "}
                        {(Array.isArray(r.horarios) ? r.horarios : []).join(", ") || "sem horário"}
                      </p>
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => excluir(r.id)} className="text-red-600 hover:text-red-700 h-7 w-7">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
