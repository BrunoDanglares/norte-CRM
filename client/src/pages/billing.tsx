import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Lock,
  Check,
  AlertTriangle,
  Users,
  Radio,
  UserCheck,
  Settings,
  FileText,
  Zap,
  Star,
  Sparkles,
  Loader2,
  CreditCard,
  QrCode,
  Barcode,
  ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PLAN_FEATURES, PLAN_DESCRIPTIONS } from "@shared/plansCatalog";

// WhatsApp do comercial para planos Enterprise / sob consulta.
const COMERCIAL_WA = "https://wa.me/5511999999999?text=Ol%C3%A1!%20Tenho%20interesse%20no%20plano%20Enterprise%20do%20Norte%20Gest%C3%A3o%20CRM.";

type BillingType = "CREDIT_CARD" | "PIX" | "BOLETO";
const METODOS: { id: BillingType; label: string; icon: typeof CreditCard; hint: string }[] = [
  { id: "CREDIT_CARD", label: "Cartão", icon: CreditCard, hint: "Cobrança automática todo mês" },
  { id: "PIX", label: "PIX", icon: QrCode, hint: "Cobrança mensal por PIX" },
  { id: "BOLETO", label: "Boleto", icon: Barcode, hint: "Boleto mensal" },
];

interface Plano {
  id: string;
  nome: string;
  slug: string;
  preco: string | null;
  limiteCanais: number | null;
  limiteClientes: number | null;
  limiteUsuarios: number | null;
  descricao: string | null;
  ativo: boolean;
}

interface BillingUsageData {
  plan: string;
  planSlug: string;
  status: string;
  subStatus: string;
  isVip: boolean;
  hasCpfCnpj: boolean;
  hasSubscription: boolean;
  trialDays: number;
  nextBilling: string;
  mrr: number;
  canaisUsed: number;
  canaisLimit: number;
  clientesUsed: number;
  clientesLimit: number;
  seatsUsed: number;
  seatsLimit: number;
}

interface AsaasInvoice {
  id: string;
  value: number;
  status: string;
  billingType: string;
  dueDate: string;
  invoiceUrl: string | null;
}

function fmt(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("pt-BR");
}

function precoFmt(preco: string | null): string {
  if (preco == null) return "Sob consulta";
  const v = Number(preco);
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function planoFeatures(p: Plano): string[] {
  // Bruno 2026-06-19: MESMA lista da landing (catálogo único @shared/plansCatalog),
  // pra a grade de Planos ficar paritária com a landing. Fallback: deriva dos limites.
  const fromCatalog = PLAN_FEATURES[p.slug];
  if (fromCatalog?.length) return fromCatalog;
  const canais = p.limiteCanais == null ? "Canais ilimitados" : `${p.limiteCanais} ${p.limiteCanais === 1 ? "canal" : "canais"} de WhatsApp`;
  const clientes = p.limiteClientes == null ? "Clientes ilimitados" : `Até ${fmt(p.limiteClientes)} clientes`;
  const usuarios = p.limiteUsuarios == null ? "Atendentes ilimitados" : `${p.limiteUsuarios} ${p.limiteUsuarios === 1 ? "atendente" : "atendentes"}`;
  return [canais, clientes, usuarios, "Atendimento omnichannel completo", "Suporte em português"];
}

const INVOICE_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  CONFIRMED: "Confirmado",
  RECEIVED: "Pago",
  RECEIVED_IN_CASH: "Pago",
  OVERDUE: "Vencido",
  REFUNDED: "Estornado",
  DELETED: "Cancelado",
};

function StatusBadge({ subStatus, label }: { subStatus: string; label: string }) {
  const cls =
    subStatus === "active" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
    subStatus === "trialing" ? "bg-blue-500/10 text-blue-500 border-blue-500/20" :
    subStatus === "pending" ? "bg-amber-500/10 text-amber-600 border-amber-500/20" :
    subStatus === "past_due" ? "bg-amber-500/10 text-amber-600 border-amber-500/20" :
    subStatus === "canceled" ? "bg-red-500/10 text-red-500 border-red-500/20" :
    "bg-muted text-muted-foreground border-border";
  return <Badge variant="outline" className={`${cls} text-[10px]`} data-testid="badge-plan-status">{label}</Badge>;
}

function UsageMeter({
  label, used, limit, color, icon: Icon,
}: {
  label: string; used: number; limit: number; color: string; icon: typeof Users;
}) {
  const isUnlimited = limit < 0;
  const pct = isUnlimited ? 15 : limit === 0 ? 0 : Math.round((used / limit) * 100);
  const isOver = !isUnlimited && pct >= 90;

  return (
    <Card className={`p-4 ${isOver ? "border-red-500/30" : ""}`} data-testid={`card-usage-${label.toLowerCase().replace(/[^a-z]/g, "")}`}>
      <div className="flex justify-between items-center mb-2 text-xs">
        <span className="text-muted-foreground flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5" />
          {label}
        </span>
        <span className={`font-bold ${isOver ? "text-red-500" : ""}`} style={isOver ? {} : { color }}>
          {fmt(used)} / {isUnlimited ? "∞" : fmt(limit)}
        </span>
      </div>
      <div className="h-[7px] bg-muted/30 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: isOver ? "#ef4444" : color }}
        />
      </div>
      {isOver && (
        <div className="flex items-center gap-1 text-[10px] text-red-500 mt-1.5 font-medium">
          <AlertTriangle className="w-3 h-3" />
          Próximo do limite
        </div>
      )}
    </Card>
  );
}

export default function Billing() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmPlano, setConfirmPlano] = useState<Plano | null>(null);
  const [metodo, setMetodo] = useState<BillingType>("CREDIT_CARD");
  const [docInput, setDocInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Painel "Gerenciar assinatura"
  const [manageOpen, setManageOpen] = useState(false);
  const [invoices, setInvoices] = useState<AsaasInvoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const { data: billingResponse, isLoading } = useQuery<{ ok: boolean; data: BillingUsageData }>({
    queryKey: ["/api/billing/usage"],
  });
  const { data: planosResponse, isLoading: loadingPlanos } = useQuery<{ ok: boolean; data: Plano[] }>({
    queryKey: ["/api/planos"],
  });

  const sub = billingResponse?.data;
  const planos = (planosResponse?.data || [])
    .filter((p) => p.ativo)
    .sort((a, b) => {
      // preço asc; sob consulta (null) por último
      if (a.preco == null) return 1;
      if (b.preco == null) return -1;
      return Number(a.preco) - Number(b.preco);
    });

  function openConfirm(p: Plano) {
    setMetodo("CREDIT_CARD");
    setDocInput("");
    setConfirmPlano(p);
  }

  async function subscribe() {
    const p = confirmPlano;
    if (!p) return;
    const needsDoc = !sub?.hasCpfCnpj;
    const doc = docInput.replace(/\D/g, "");
    if (needsDoc && doc.length !== 11 && doc.length !== 14) {
      toast({ title: "Informe o CPF ou CNPJ", description: "11 dígitos (CPF) ou 14 (CNPJ) para emitir a cobrança.", variant: "destructive" });
      return;
    }
    try {
      setSubmitting(true);
      const res = await apiRequest("POST", "/api/asaas/subscribe", {
        planoId: p.id,
        billingType: metodo,
        cpfCnpj: needsDoc ? doc : undefined,
      });
      const json = await res.json();
      if (json.url) { window.location.href = json.url; return; }
      if (json.ok) {
        toast({ title: "Assinatura criada", description: "Sua cobrança foi gerada. Acompanhe em Gerenciar assinatura." });
        setConfirmPlano(null);
        queryClient.invalidateQueries({ queryKey: ["/api/billing/usage"] });
        return;
      }
      throw new Error(json.message || json.error || "Não foi possível criar a assinatura");
    } catch (e: any) {
      toast({ title: "Não foi possível assinar", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  function enterprise(p: Plano) {
    window.open(COMERCIAL_WA, "_blank");
  }

  async function openManage() {
    setManageOpen(true);
    setConfirmCancel(false);
    setLoadingInvoices(true);
    try {
      const res = await apiRequest("GET", "/api/asaas/subscription");
      const json = await res.json();
      setInvoices(json.invoices || []);
    } catch (e: any) {
      toast({ title: "Não foi possível carregar as faturas", description: e.message, variant: "destructive" });
    } finally {
      setLoadingInvoices(false);
    }
  }

  async function cancelSubscription() {
    try {
      setCanceling(true);
      const res = await apiRequest("POST", "/api/asaas/cancel");
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Falha ao cancelar");
      toast({ title: "Assinatura cancelada", description: "A cobrança recorrente foi interrompida. Se você já pagou este período, o acesso continua até o vencimento." });
      setManageOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/billing/usage"] });
    } catch (e: any) {
      toast({ title: "Não foi possível cancelar", description: e.message, variant: "destructive" });
    } finally {
      setCanceling(false);
    }
  }

  function scrollToPlanos() {
    document.getElementById("grade-planos")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (isLoading || loadingPlanos) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-[900px] mx-auto py-6 px-6 space-y-5">
          <Skeleton className="h-28 w-full" />
          <div className="grid grid-cols-3 gap-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-80" />
            <Skeleton className="h-80" />
            <Skeleton className="h-80" />
          </div>
        </div>
      </div>
    );
  }

  const s = sub!;
  const needsDoc = !s.hasCpfCnpj;
  const isPaywall = typeof window !== "undefined" && window.location.pathname === "/assinatura";

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[900px] mx-auto py-6 px-6">

        {/* Banners de estado: VIP / paywall / pagamento pendente */}
        {s.isVip ? (
          <div className="mb-4 flex items-center gap-2 text-[12px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2.5" data-testid="banner-vip">
            <Sparkles className="w-4 h-4 flex-shrink-0" />
            <span><strong>Cliente VIP · cortesia.</strong> Seu acesso é liberado sem cobrança.</span>
          </div>
        ) : isPaywall ? (
          <div className="mb-4 flex items-center gap-2 text-[12px] text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2.5" data-testid="banner-paywall">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span><strong>Assinatura pendente.</strong> Escolha um plano e regularize o pagamento pra voltar a usar o Norte Gestão.</span>
          </div>
        ) : s.subStatus === "past_due" ? (
          <div className="mb-4 flex items-center gap-2 text-[12px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2.5" data-testid="banner-past-due">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span><strong>Pagamento pendente.</strong> Regularize pra não perder o acesso ao fim da tolerância.</span>
          </div>
        ) : null}

        {/* Plano atual */}
        <Card className="p-5 mb-5 border-primary/30 bg-primary/5" data-testid="card-current-plan">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-[11px] font-bold text-primary tracking-wide mb-1">PLANO ATUAL</div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-xl font-bold" data-testid="text-plan-name">{s.plan}</span>
                <StatusBadge subStatus={s.subStatus} label={s.status} />
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {s.trialDays > 0 ? (
                  <span>Teste grátis: {s.trialDays} {s.trialDays === 1 ? "dia restante" : "dias restantes"}</span>
                ) : s.hasSubscription && s.nextBilling ? (
                  <span>Próxima cobrança: {s.nextBilling} — R$ {fmt(s.mrr)}/mês</span>
                ) : (
                  <span>Sem assinatura ativa</span>
                )}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {s.hasSubscription ? (
                <Button variant="outline" onClick={openManage} data-testid="button-manage">
                  <Settings className="w-3.5 h-3.5 mr-1" />
                  Gerenciar assinatura
                </Button>
              ) : (
                <Button onClick={scrollToPlanos} data-testid="button-choose-plan">
                  <Zap className="w-3.5 h-3.5 mr-1" />
                  {s.trialDays > 0 ? "Assinar um plano" : "Escolher plano"}
                </Button>
              )}
            </div>
          </div>
        </Card>

        {/* Medidores de uso: Canais × Clientes (SGP) × Atendentes */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <UsageMeter label="Canais" used={s.canaisUsed} limit={s.canaisLimit} color="hsl(var(--primary))" icon={Radio} />
          <UsageMeter label="Contatos" used={s.clientesUsed} limit={s.clientesLimit} color="#16a34a" icon={UserCheck} />
          <UsageMeter label="Atendentes" used={s.seatsUsed} limit={s.seatsLimit} color="#f59e0b" icon={Users} />
        </div>

        {/* Grade de planos */}
        <div id="grade-planos" className="text-center mb-7 scroll-mt-4">
          <div className="text-2xl font-bold mb-1.5">Escolha seu plano</div>
          <p className="text-sm text-muted-foreground">
            Planos por número de canais e de clientes atendidos — cobrança mensal, 14 dias de teste grátis.
          </p>
        </div>

        <div className={`grid gap-4 mb-8 ${planos.length >= 4 ? "grid-cols-4" : planos.length === 3 ? "grid-cols-3" : "grid-cols-2 max-w-[720px] mx-auto"}`} data-testid="grid-pricing-cards">
          {planos.map((p, idx) => {
            const current = s.planSlug === p.slug;
            const isEnterprise = p.preco == null;
            const popular = !isEnterprise && idx === 1; // 2º plano (Crescimento) = destaque
            return (
              <Card
                key={p.id}
                className={`p-5 relative ${popular ? "border-primary border-2 scale-[1.02]" : isEnterprise ? "border-dashed border-2" : ""}`}
                data-testid={`card-plan-${p.slug}`}
              >
                {popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[9px] font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap flex items-center gap-1">
                    <Star className="w-2.5 h-2.5" />
                    MAIS POPULAR
                  </div>
                )}
                {current && (
                  <div className="absolute top-2.5 right-2.5">
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[8px]">Atual</Badge>
                  </div>
                )}
                <div className="text-base font-bold mb-1">{p.nome}</div>
                <div className="text-[11px] text-muted-foreground mb-3 leading-relaxed min-h-[32px]">{PLAN_DESCRIPTIONS[p.slug] || p.descricao}</div>
                <div className="mb-4">
                  {isEnterprise ? (
                    <span className="text-lg font-bold text-muted-foreground">Sob consulta</span>
                  ) : (
                    <>
                      <span className="text-3xl font-bold">{precoFmt(p.preco)}</span>
                      <span className="text-xs text-muted-foreground">/mês</span>
                    </>
                  )}
                </div>
                <div className="mb-4">
                  {planoFeatures(p).map((f, i) => (
                    <div key={i} className="text-[11px] py-1 flex items-center gap-2">
                      <Check className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                      <span className="text-muted-foreground">{f}</span>
                    </div>
                  ))}
                </div>
                <Button
                  className="w-full text-xs"
                  size="default"
                  variant={current ? "outline" : popular ? "default" : "secondary"}
                  disabled={current}
                  onClick={() => (isEnterprise ? enterprise(p) : openConfirm(p))}
                  data-testid={`button-plan-${p.slug}`}
                >
                  {current ? (
                    <><Check className="w-3 h-3 mr-1" /> Plano atual</>
                  ) : isEnterprise ? (
                    "Falar com comercial"
                  ) : (
                    `Assinar ${p.nome}`
                  )}
                </Button>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Modal de assinatura: método + CPF/CNPJ → redirect pro Asaas */}
      <Dialog open={confirmPlano !== null} onOpenChange={() => !submitting && setConfirmPlano(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <Zap className="w-4 h-4 inline mr-1" />
              Assinar {confirmPlano?.nome}
            </DialogTitle>
          </DialogHeader>
          <Card className="p-4 bg-primary/5 border-primary/20">
            <div className="flex justify-between items-center mb-2">
              <div className="text-sm font-semibold">{confirmPlano?.nome}</div>
              <div className="text-lg font-bold text-primary">
                {confirmPlano && precoFmt(confirmPlano.preco)}
                <span className="text-[11px] font-normal text-muted-foreground">/mês</span>
              </div>
            </div>
            {confirmPlano && (
              <div className="text-[11px] text-muted-foreground space-y-0.5">
                {planoFeatures(confirmPlano).slice(0, 3).map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5"><Check className="w-2.5 h-2.5 text-emerald-500" />{f}</div>
                ))}
              </div>
            )}
          </Card>

          {/* Forma de pagamento */}
          <div>
            <div className="text-[11px] font-semibold mb-1.5">Forma de pagamento</div>
            <div className="grid grid-cols-3 gap-2">
              {METODOS.map((m) => {
                const active = metodo === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMetodo(m.id)}
                    className={`flex flex-col items-center gap-1 rounded-lg border p-2.5 transition-colors ${active ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted text-muted-foreground"}`}
                    data-testid={`button-metodo-${m.id}`}
                  >
                    <m.icon className="w-4 h-4" />
                    <span className="text-[11px] font-bold">{m.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1.5">
              {METODOS.find((m) => m.id === metodo)?.hint}
            </div>
          </div>

          {/* CPF/CNPJ (só se ainda não tiver no cadastro) */}
          {needsDoc && (
            <div>
              <div className="text-[11px] font-semibold mb-1.5">CPF ou CNPJ do titular</div>
              <Input
                value={docInput}
                onChange={(e) => setDocInput(e.target.value)}
                placeholder="Somente números"
                inputMode="numeric"
                data-testid="input-cpf-cnpj"
              />
              <div className="text-[10px] text-muted-foreground mt-1">Necessário para emitir a cobrança e a nota fiscal.</div>
            </div>
          )}

          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-md text-xs">
            <Sparkles className="w-3.5 h-3.5 inline mr-1 text-emerald-500" />
            <strong>14 dias grátis.</strong> A primeira cobrança só acontece ao fim do teste. Cancele a qualquer momento.
          </div>
          <div className="text-[11px] text-muted-foreground">
            Ao continuar você será redirecionado ao Asaas — ambiente seguro de pagamento.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmPlano(null)} disabled={submitting} data-testid="button-upgrade-cancel">Cancelar</Button>
            <Button onClick={subscribe} disabled={submitting} data-testid="button-checkout">
              {submitting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Lock className="w-3.5 h-3.5 mr-1" />}
              Ir para o pagamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Painel: Gerenciar assinatura (faturas + cancelar) */}
      <Dialog open={manageOpen} onOpenChange={() => !canceling && setManageOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <Settings className="w-4 h-4 inline mr-1" />
              Gerenciar assinatura
            </DialogTitle>
          </DialogHeader>

          <div className="text-[11px] font-semibold mb-1 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> Faturas
          </div>
          <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
            {loadingInvoices ? (
              <>
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </>
            ) : invoices.length === 0 ? (
              <p className="text-xs text-muted-foreground/70 py-2">Nenhuma fatura ainda.</p>
            ) : (
              invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-2.5" data-testid={`invoice-${inv.id}`}>
                  <div className="min-w-0">
                    <div className="text-xs font-bold">R$ {fmt(inv.value)}</div>
                    <div className="text-[10px] text-muted-foreground">
                      vence {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("pt-BR") : "—"} · {INVOICE_STATUS_LABEL[inv.status] || inv.status}
                    </div>
                  </div>
                  {inv.invoiceUrl && (
                    <a href={inv.invoiceUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary font-semibold flex items-center gap-1 shrink-0">
                      Abrir <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              ))
            )}
          </div>

          {confirmCancel && (
            <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed" data-testid="text-cancel-warning">
              A cobrança recorrente será interrompida no Asaas. Você mantém o acesso até o fim do período já pago e pode reassinar quando quiser.
            </p>
          )}

          <DialogFooter className="sm:justify-between">
            {!confirmCancel ? (
              <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600" onClick={() => setConfirmCancel(true)} data-testid="button-cancel-sub">
                Cancelar assinatura
              </Button>
            ) : (
              <Button variant="destructive" size="sm" onClick={cancelSubscription} disabled={canceling} data-testid="button-cancel-sub-confirm">
                {canceling ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5 mr-1" />}
                Confirmar cancelamento
              </Button>
            )}
            <Button variant="outline" onClick={() => setManageOpen(false)} disabled={canceling}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
