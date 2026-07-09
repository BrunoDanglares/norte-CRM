import { useEffect, useRef, useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, apiFetchRaw } from "@/lib/queryClient";
import ContactAvatar from "@/components/ContactAvatar";
import AvatarLightbox from "@/components/AvatarLightbox";
import {
  Mail, Phone, Briefcase, Pencil, UserPlus, Loader2,
  Send, Search, X, MessageCircle, Headphones, ChevronDown, ChevronUp,
  Tags as TagsIcon, StickyNote, Plus, Sparkles,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { suggestCpfFromMessages, formatCpfCnpj } from "@/lib/cpf-detect";
import type { ConvExtended } from "./helpers";

interface CustomerTabProps {
  selected: ConvExtended;
  contactsData?: any[];
  onOpenContactProfile?: () => void;
  // Bruno 2026-06-04: CPF resolvido no pai (override > sessão > contato) —
  // compartilhado entre todas as abas. onApplyCpf persiste no contato + propaga.
  effectiveCpf?: string | null;
  onApplyCpf?: (cpf: string) => void;
  // Tags pré-cadastradas do workspace (sugestões pro editor de tags).
  availableTags?: { id: number; nome: string; cor: string }[];
}

// Bruno 2026-05-21: ficha compacta do cliente exibida quando o rail vertical
// está em "Cliente". Match por telefone normalizado. Se contato ainda não
// existe, cria silencioso 1x com nome+tel da conv (regra escolhida no produto).
// Layout focado em LEITURA — edição completa fica no drawer ContactProfilePanel.
//
// Bruno 2026-05-30 (print Nádia 409):
// - POST /api/contacts agora é idempotente (retorna 200 quando já existe).
// - Toast 409 não aparece mais. Mantém onError pra erros reais.
//
// Bruno 2026-06-28: enriquecimento ERP/ISP REMOVIDO (módulo ISP descontinuado;
// rota POST /api/isp/erp não existe mais). Painel agora é genérico multi-segmento:
// dados editáveis do contato, CPF genérico (com sugestão do chat), tags e
// histórico. A sessão (GET /api/conversations/:id/session) segue só pra rotular
// "CPF identificado no chat".

function normalizePhone(p: any): string {
  return String(p ?? "").replace(/\D/g, "");
}

function findContact(list: any[] | undefined, conv: ConvExtended): any | null {
  if (!list?.length || !conv?.telefone) return null;
  const target = normalizePhone(conv.telefone);
  if (!target) return null;
  return (
    list.find((c) => {
      const cp = normalizePhone(c.telefone);
      if (!cp) return false;
      if (cp === target) return true;
      // Tolerância pra 55 + 9º dígito (padrão BR)
      if (cp.startsWith("55") && cp.slice(2) === target) return true;
      if (target.startsWith("55") && target.slice(2) === cp) return true;
      return false;
    }) ?? null
  );
}

function formatCpf(cpf: string | null | undefined): string {
  if (!cpf) return "";
  const s = String(cpf).replace(/\D/g, "");
  if (s.length !== 11) return cpf;
  return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9, 11)}`;
}

function formatDateTime(s: any): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function CustomerTab({ selected, contactsData, onOpenContactProfile, effectiveCpf, onApplyCpf, availableTags }: CustomerTabProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const listContact = findContact(contactsData, selected);

  // Bruno 2026-06-19: /api/contacts é PAGINADA (teto 100). Em tenant grande o
  // contato de uma conversa antiga/resolvida fica de fora → findContact falha e
  // o painel travava em "Cadastrando contato…" pra sempre. Fallback: busca o
  // contato pontualmente por telefone. Só dispara quando a lista não bateu.
  const phoneDigitsLookup = normalizePhone(selected?.telefone);
  const byPhoneQuery = useQuery({
    queryKey: ["/api/contacts/by-phone", phoneDigitsLookup],
    enabled: !listContact && phoneDigitsLookup.length >= 8,
    retry: false,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await apiFetchRaw(`/api/contacts/by-phone?telefone=${encodeURIComponent(phoneDigitsLookup)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Falha ao buscar contato");
      return res.json();
    },
  });
  const contact = listContact || byPhoneQuery.data || null;

  // ── Edição do CPF (trocar / pesquisar outro contrato) ─────────────────
  const [editingCpf, setEditingCpf] = useState(false);
  const [cpfInput, setCpfInput] = useState("");

  // Sugestão do CPF/CNPJ que o cliente digitou no chat (mesmo cache do inbox).
  const { data: chatMsgsCpf } = useQuery<any[]>({
    queryKey: ["/api/conversations", selected?.id ?? null, "messages"],
    enabled: !!selected?.id,
    staleTime: 30_000,
  });
  const suggestedChatCpf = useMemo(() => suggestCpfFromMessages(chatMsgsCpf), [chatMsgsCpf]);
  // Bruno 2026-06-04: card "Histórico" (migrado da antiga aba Início) — recolhível.
  const [historicoExpanded, setHistoricoExpanded] = useState(false);
  // Campos editáveis do contato (migrados da aba Início + ficha) — auto-save.
  const [emailVal, setEmailVal] = useState("");
  const [empresaVal, setEmpresaVal] = useState("");
  const [notasVal, setNotasVal] = useState("");
  useEffect(() => {
    setEditingCpf(false); setCpfInput(""); setHistoricoExpanded(false);
  }, [selected?.id]);
  useEffect(() => {
    setEmailVal(contact?.email || "");
    setEmpresaVal(contact?.empresa || "");
    setNotasVal(contact?.notas || "");
  }, [contact?.id]);
  const submitCpf = () => {
    const clean = cpfInput.replace(/\D/g, "");
    if (clean.length !== 11) {
      toast({ title: "CPF inválido", description: "Digite os 11 dígitos.", variant: "destructive" });
      return;
    }
    onApplyCpf?.(clean);
    setEditingCpf(false);
  };

  // ── Buscar sessão ISP (CPF + contrato salvos pelo agente) ──────────────
  // Bruno 2026-05-30: quando cliente identifica CPF no chat, agente persiste
  // em isp_session_state.cpf (top-level). UI usa pra puxar enrichment ERP.
  const sessionQuery = useQuery({
    queryKey: ["/api/conversations", selected?.id, "session"],
    enabled: !!selected?.id,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/conversations/${selected.id}/session`, undefined);
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Falha ao buscar sessão");
      }
      return res.json();
    },
    staleTime: 10_000,
    refetchOnMount: "always", // Bruno 2026-06-08: relê no reopen (evita cache stale com cpf NULL)
  });

  // CPF que o BOT identificou nesta conversa (pra rotular "identificado no chat").
  const sessionCpf: string | null =
    sessionQuery.data?.cpf ?? sessionQuery.data?.session?.cpf ?? null;
  // CPF efetivo do painel: override/edição do atendente > sessão > contato.
  // Vem do pai (compartilhado entre abas); fallback local se prop ausente.
  const resolvedCpf: string | null = effectiveCpf ?? sessionCpf ?? contact?.cpf ?? null;
  const cpfFromChat = !!sessionCpf && resolvedCpf === sessionCpf;

  // ── Auto-create silencioso do contato (anti-loop) ─────────────────────
  const triggeredForRef = useRef<string | null>(null);
  const createMutation = useMutation({
    mutationFn: async (body: { nome: string; telefone: string }) => {
      const res = await apiRequest("POST", "/api/contacts", {
        nome: body.nome,
        telefone: body.telefone,
        canal: selected.canal || "WhatsApp",
      });
      if (!res.ok && res.status !== 201 && res.status !== 200) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as any)?.message || "Falha ao criar contato");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/contacts"] });
      qc.invalidateQueries({ queryKey: ["/api/contacts/by-phone"] });
    },
    onError: (err: any) => {
      // Bruno 2026-05-30: 409 já é tratado no backend (retorna 200). Toast
      // só aparece em erros reais (5xx, network).
      toast({ title: "Não consegui cadastrar o contato", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (contact) return;
    if (!selected?.telefone) return;
    // Espera o fallback por telefone resolver — se o contato existe mas estava
    // fora da página, byPhoneQuery acha e não criamos nada. Só cria quando o
    // contato REALMENTE não existe (lista e fallback vazios).
    if (byPhoneQuery.isFetching) return;
    const tel = normalizePhone(selected.telefone);
    if (!tel) return;
    if (triggeredForRef.current === tel) return;
    triggeredForRef.current = tel;
    createMutation.mutate({ nome: selected.nome || tel, telefone: selected.telefone });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact, selected?.telefone, selected?.nome, byPhoneQuery.isFetching]);

  // ── Mutation: enviar mensagem no chat ─────────────────────────────────
  // Bruno 2026-06-01 (cliente reclamou que não copia o PIX): aceita uma lista
  // de mensagens enviadas SEPARADAMENTE. Códigos copia-e-cola (PIX / linha
  // digitável) DEVEM ir sozinhos numa mensagem própria — quando vão grudados
  // ao header ("💳 PIX...\n\n<código>") o WhatsApp copia tudo junto no
  // long-press e o código cola inválido no banco. Mensagem só com o código →
  // long-press copia exatamente o código.
  const sendMutation = useMutation({
    mutationFn: async (texto: string | string[]) => {
      const parts = (Array.isArray(texto) ? texto : [texto])
        .map((t) => (t ?? "").toString())
        .filter((t) => t.trim().length > 0);
      let last: any = null;
      for (const part of parts) {
        const res = await apiRequest("POST", `/api/conversations/${selected.id}/messages`, {
          texto: part,
          direction: "out",
          tipo: "text",
        });
        if (!res.ok) throw new Error("Falha ao enviar");
        last = await res.json();
      }
      return last;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/conversations", selected.id] });
      toast({ title: "Enviado no chat 👌", variant: "default" });
    },
    onError: (err: any) => {
      toast({ title: "Não consegui enviar", description: err.message, variant: "destructive" });
    },
  });

  const sendToChat = (texto: string | string[]) => {
    if (sendMutation.isPending) return;
    sendMutation.mutate(texto);
  };

  // ── Edição inline do contato (e-mail / empresa / anotações / tags) ──────
  const patchContact = useMutation({
    mutationFn: async (patch: Record<string, any>) => {
      if (!contact?.id) throw new Error("Contato ainda não cadastrado");
      const res = await apiRequest("PATCH", `/api/contacts/${contact.id}`, patch);
      if (!res.ok) throw new Error("Falha ao salvar");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/contacts"] }),
    onError: (e: any) => toast({ title: "Não consegui salvar", description: e.message, variant: "destructive" }),
  });
  const saveContactField = (field: string, value: string) => {
    if (!contact?.id) return;
    if (((contact as any)?.[field] ?? "") === (value ?? "")) return;
    patchContact.mutate({ [field]: value || null });
  };
  const [contactTags, setContactTagsLocal] = useState<string[]>([]);
  useEffect(() => { setContactTagsLocal(Array.isArray(contact?.tags) ? contact.tags : []); }, [contact?.id]);
  const setContactTags = (next: string[]) => { setContactTagsLocal(next); if (contact?.id) patchContact.mutate({ tags: next }); };

  // ── Tags do atendimento (conversa) — PATCH /conversations/:id/tags ──────
  const [convTags, setConvTagsLocal] = useState<string[]>([]);
  useEffect(() => { setConvTagsLocal(Array.isArray((selected as any)?.tags) ? (selected as any).tags : []); }, [selected?.id]);
  const patchConvTags = useMutation({
    mutationFn: async (tags: string[]) => {
      const res = await apiRequest("PATCH", `/api/conversations/${selected.id}/tags`, { tags });
      if (!res.ok) throw new Error("Falha ao salvar tags");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/conversations"] }),
    onError: (e: any) => toast({ title: "Não consegui salvar as tags", description: e.message, variant: "destructive" }),
  });
  const setConvTags = (next: string[]) => { setConvTagsLocal(next); patchConvTags.mutate(next); };

  const tagSuggestions: string[] = (availableTags || []).map((t) => t.nome);

  // ── Histórico de atendimentos do contato (lazy, migrado da aba Início) ──
  // Bruno 2026-06-04 (revisão pré-deploy): o endpoint antigo
  // /api/conversations/historico-por-telefone NÃO EXISTIA (sempre 400). Aponta
  // pro /api/relatorios/clientes/atendimentos (protocolos por telefone), com
  // janela ampla (2020→hoje) pra contar o histórico completo do contato.
  const histPhone = contact?.telefone ?? selected?.telefone ?? "";
  const { data: histData } = useQuery<any>({
    queryKey: ["/api/relatorios/clientes/atendimentos", "hist", histPhone],
    enabled: historicoExpanded && !!histPhone,
    queryFn: async () => {
      const hoje = new Date().toISOString().slice(0, 10);
      const r = await apiRequest("GET", `/api/relatorios/clientes/atendimentos?telefone=${encodeURIComponent(histPhone)}&dataInicio=2020-01-01&dataFim=${hoje}`);
      return await r.json();
    },
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  const historicoCount = Number(histData?.total ?? (Array.isArray(histData?.items) ? histData.items.length : 0));

  // ── Derived data ──────────────────────────────────────────────────────
  const nome = contact?.nome || selected.nome || "Sem nome";
  const telefone = contact?.telefone ?? selected.telefone ?? null;
  const fotoUrl = contact?.fotoUrl ?? (selected as any)?.avatar ?? null;
  const [avatarOpen, setAvatarOpen] = useState(false); // Bruno 2026-06-18: lightbox da foto

  const cpfDisplay = formatCpf(resolvedCpf || contact?.cpf);

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3" data-testid="customer-tab">
      {/* Header — avatar + nome + tel */}
      <div className="flex flex-col items-center text-center pt-2 pb-3 border-b border-border/60">
        <ContactAvatar
          nome={nome}
          fotoUrl={fotoUrl}
          size={64}
          rounded="50%"
          onClick={fotoUrl ? () => setAvatarOpen(true) : undefined}
        />
        {avatarOpen && fotoUrl && (
          <AvatarLightbox src={fotoUrl} alt={nome} onClose={() => setAvatarOpen(false)} />
        )}
        <div className="mt-2 font-semibold text-[14px] text-foreground truncate max-w-full" title={nome}>
          {nome}
        </div>
        {telefone && (
          <div className="mt-0.5 text-[11px] text-muted-foreground flex items-center gap-1">
            <Phone className="w-3 h-3" /> {telefone}
          </div>
        )}
        {createMutation.isPending && !contact && (
          <div className="mt-1.5 text-[10px] text-muted-foreground italic flex items-center gap-1">
            <Loader2 className="w-2.5 h-2.5 animate-spin" /> cadastrando contato…
          </div>
        )}
      </div>

      {/* Dados do contato — editáveis com auto-save (migrado/expandido da aba Início) */}
      <div className="rounded-md border border-border bg-card p-2.5 space-y-2.5" data-testid="contact-fields-edit">
        <div>
          <label className="text-[9.5px] uppercase tracking-wide text-muted-foreground/80 font-semibold flex items-center gap-1 mb-1">
            <Mail className="w-2.5 h-2.5" /> E-mail
          </label>
          <input
            value={emailVal}
            onChange={(e) => setEmailVal(e.target.value)}
            onBlur={() => saveContactField("email", emailVal)}
            placeholder={contact?.id ? "Adicionar e-mail" : "Cadastrando contato…"}
            disabled={!contact?.id}
            className="w-full h-7 px-2 rounded-md border border-border bg-background text-[12px] outline-none focus:border-primary disabled:opacity-60"
            data-testid="input-contact-email"
          />
        </div>
        <div>
          <label className="text-[9.5px] uppercase tracking-wide text-muted-foreground/80 font-semibold flex items-center gap-1 mb-1">
            <Briefcase className="w-2.5 h-2.5" /> Empresa
          </label>
          <input
            value={empresaVal}
            onChange={(e) => setEmpresaVal(e.target.value)}
            onBlur={() => saveContactField("empresa", empresaVal)}
            placeholder={contact?.id ? "Adicionar empresa" : "Cadastrando contato…"}
            disabled={!contact?.id}
            className="w-full h-7 px-2 rounded-md border border-border bg-background text-[12px] outline-none focus:border-primary disabled:opacity-60"
            data-testid="input-contact-empresa"
          />
        </div>
        <div>
          <label className="text-[9.5px] uppercase tracking-wide text-muted-foreground/80 font-semibold flex items-center gap-1 mb-1">
            <TagsIcon className="w-2.5 h-2.5" /> Tags do cliente
          </label>
          <TagEditor value={contactTags} onChange={setContactTags} suggestions={tagSuggestions} placeholder="Adicionar tag" disabled={!contact?.id} testid="cliente" />
        </div>
        <div>
          <label className="text-[9.5px] uppercase tracking-wide text-muted-foreground/80 font-semibold flex items-center gap-1 mb-1">
            <StickyNote className="w-2.5 h-2.5" /> Anotações
          </label>
          <textarea
            value={notasVal}
            onChange={(e) => setNotasVal(e.target.value)}
            onBlur={() => saveContactField("notas", notasVal)}
            rows={3}
            placeholder={contact?.id ? "Clique para adicionar anotações…" : "Cadastrando contato…"}
            disabled={!contact?.id}
            className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-[12px] leading-snug resize-none outline-none focus:border-primary disabled:opacity-60"
            data-testid="textarea-contact-notas"
          />
        </div>
      </div>

      {/* CPF do cliente — persistido no contato, compartilhado entre abas,
          editável pra pesquisar outro contrato (mesma pessoa, vários contratos) */}
      <div className="rounded-md border border-primary/20 bg-primary/5 p-2.5">
        {editingCpf ? (
          <div data-testid="cpf-edit">
            <div className="text-[9.5px] uppercase tracking-wide text-primary font-semibold mb-1">
              Trocar CPF
            </div>
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={cpfInput}
                onChange={(e) => setCpfInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitCpf(); if (e.key === "Escape") setEditingCpf(false); }}
                placeholder="CPF (só números)"
                inputMode="numeric"
                className="flex-1 min-w-0 h-7 px-2 rounded-md border border-border bg-background text-[12px] tabular-nums outline-none focus:border-primary"
                data-testid="input-cpf"
              />
              <button
                type="button"
                onClick={submitCpf}
                className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[10.5px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                data-testid="btn-cpf-buscar"
              >
                <Search className="w-3 h-3" /> Buscar
              </button>
              <button
                type="button"
                onClick={() => setEditingCpf(false)}
                className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-secondary transition-colors"
                title="Cancelar"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="text-[9.5px] text-muted-foreground mt-1">
              Mesma pessoa com vários contratos? Pesquise outro CPF — fica salvo pro contato.
            </div>
          </div>
        ) : resolvedCpf ? (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[9.5px] uppercase tracking-wide text-primary font-semibold">
                {cpfFromChat ? "CPF identificado no chat" : "CPF do cliente"}
              </div>
              <div className="text-[12.5px] font-semibold text-foreground truncate">
                {cpfDisplay}
              </div>
            </div>
            <div className="flex flex-col items-stretch gap-1 flex-shrink-0">
              <button
                type="button"
                className="inline-flex items-center justify-center gap-1 h-7 px-2 rounded-md text-[10.5px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                onClick={() => sendToChat(`Seu CPF cadastrado: ${cpfDisplay}`)}
                disabled={sendMutation.isPending || !cpfDisplay}
                data-testid="btn-send-cpf"
                title="Enviar CPF no chat"
              >
                <Send className="w-3 h-3" /> Enviar
              </button>
              {onApplyCpf && (
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-1 h-6 px-2 rounded-md text-[10px] font-medium bg-secondary hover:bg-secondary/70 text-foreground transition-colors"
                  onClick={() => { setCpfInput(resolvedCpf || ""); setEditingCpf(true); }}
                  data-testid="btn-cpf-trocar"
                  title="Trocar CPF / pesquisar outro contrato"
                >
                  <Pencil className="w-2.5 h-2.5" /> Trocar
                </button>
              )}
            </div>
          </div>
        ) : onApplyCpf ? (
          <div data-testid="cpf-identify">
            <div className="text-[9.5px] uppercase tracking-wide text-primary font-semibold mb-1">
              Identificar cliente
            </div>
            {suggestedChatCpf && cpfInput.replace(/\D/g, "") !== suggestedChatCpf && (
              <button
                type="button"
                onClick={() => setCpfInput(formatCpfCnpj(suggestedChatCpf))}
                className="w-full mb-1.5 flex items-center gap-2 px-2 py-1.5 rounded-md border border-primary/30 bg-primary/[0.06] hover:bg-primary/[0.12] text-left transition-colors group"
                data-testid="btn-suggested-cpf-customer"
                title="Preencher com o CPF/CNPJ que o cliente enviou no chat"
              >
                <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="text-[9px] text-muted-foreground">Detectado no chat — toque pra usar</p>
                  <p className="text-[12px] font-semibold tabular-nums text-foreground">{formatCpfCnpj(suggestedChatCpf)}</p>
                </div>
                <span className="text-[10px] font-semibold text-primary shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">Usar</span>
              </button>
            )}
            <div className="flex items-center gap-1.5">
              <input
                value={cpfInput}
                onChange={(e) => setCpfInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitCpf(); }}
                placeholder="Digite o CPF do cliente"
                inputMode="numeric"
                className="flex-1 min-w-0 h-7 px-2 rounded-md border border-border bg-background text-[12px] tabular-nums outline-none focus:border-primary"
                data-testid="input-cpf"
              />
              <button
                type="button"
                onClick={submitCpf}
                className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[10.5px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                data-testid="btn-cpf-buscar"
              >
                <Search className="w-3 h-3" /> Buscar
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Atendimento — info da conversa atual (migrado da aba Início) */}
      <div className="bg-card border border-border rounded-lg p-3 space-y-1.5">
        <div className="flex items-center gap-1.5 mb-1">
          <MessageCircle className="w-3.5 h-3.5 text-muted-foreground" />
          <h4 className="text-[11px] font-semibold tracking-wide">Atendimento</h4>
        </div>
        <div className="border-t border-border/60" />
        <div className="grid grid-cols-2 gap-y-1 gap-x-2 text-[10.5px]">
          <span className="text-muted-foreground">Iniciado em</span>
          <span className="tabular-nums text-right">{formatDateTime((selected as any)?.createdAt || (selected as any)?.created_at)}</span>
          <span className="text-muted-foreground">Canal</span>
          <span className="text-right truncate">{selected?.canal || "—"}</span>
          <span className="text-muted-foreground">Atendente</span>
          <span className="text-right truncate font-medium">{(selected as any)?.assignedUserName || (selected as any)?.assigned_user_name || <em className="text-muted-foreground/70">Sem atendente</em>}</span>
        </div>
        <div className="pt-1.5 mt-0.5 border-t border-border/60">
          <div className="text-[9.5px] uppercase tracking-wide text-muted-foreground/80 font-semibold flex items-center gap-1 mb-1">
            <TagsIcon className="w-2.5 h-2.5" /> Tags do atendimento
          </div>
          {/* Bruno 2026-06-05: removidas as tags sugeridas (+Novo/+Parceiro/etc.)
              do painel — mantém só o campo de adicionar tag livre. */}
          <TagEditor value={convTags} onChange={setConvTags} suggestions={[]} placeholder="Adicionar tag" testid="atendimento" />
        </div>
      </div>

      {/* Histórico — colapsável (migrado da aba Início) */}
      {!!histPhone && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setHistoricoExpanded((v) => !v)}
            className="w-full flex items-center justify-between gap-2 p-3 hover:bg-muted/40 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Headphones className="w-3.5 h-3.5 text-muted-foreground" />
              <h4 className="text-[11px] font-semibold tracking-wide">Histórico</h4>
              {historicoExpanded && historicoCount > 0 && (
                <span className="text-[10px] text-muted-foreground tabular-nums">({historicoCount})</span>
              )}
            </div>
            {historicoExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
          </button>
          {historicoExpanded && (
            <div className="px-3 pb-3 border-t border-border/60 pt-2">
              {historicoCount === 0 ? (
                <div className="text-center py-2 text-[10.5px] text-muted-foreground">Nenhum atendimento anterior.</div>
              ) : (
                <div className="text-[10.5px] text-muted-foreground">
                  <span className="font-semibold text-foreground tabular-nums">{historicoCount}</span> atendimento{historicoCount === 1 ? "" : "s"} registrado{historicoCount === 1 ? "" : "s"} desse contato.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* CTA editar */}
      <div className="flex items-center gap-1.5 mt-2">
        <button
          type="button"
          onClick={() => onOpenContactProfile?.()}
          disabled={!contact}
          className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-md text-[11.5px] font-semibold bg-secondary hover:bg-secondary/80 text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="button-open-contact-profile"
          title={!contact ? "Aguardando o cadastro" : "Abrir ficha completa pra editar"}
        >
          {contact ? <Pencil className="w-3 h-3" /> : <UserPlus className="w-3 h-3" />}
          {contact ? "Editar ficha completa" : "Cadastro em andamento…"}
        </button>
      </div>
    </div>
  );
}

// Editor de tags reutilizável (Tags do cliente + Tags do atendimento). Chips
// removíveis + input (Enter pra adicionar) + sugestões do workspace.
function TagEditor({
  value, onChange, suggestions, placeholder, disabled, testid,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  disabled?: boolean;
  testid?: string;
}) {
  const [input, setInput] = useState("");
  const add = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (value.some((v) => v.toLowerCase() === t.toLowerCase())) { setInput(""); return; }
    onChange([...value, t]);
    setInput("");
  };
  const remove = (t: string) => onChange(value.filter((v) => v !== t));
  const remaining = (suggestions || []).filter(
    (s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div className="space-y-1.5" data-testid={`tag-editor-${testid || ""}`}>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full text-[10px] font-medium bg-primary/10 text-primary">
              {t}
              {!disabled && (
                <button type="button" onClick={() => remove(t)} className="hover:text-rose-600" title="Remover">
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {!disabled && (
        <>
          <div className="flex items-center gap-1.5">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(input); } }}
              placeholder={placeholder || "Adicionar tag"}
              className="flex-1 min-w-0 h-7 px-2 rounded-md border border-border bg-background text-[11.5px] outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => add(input)}
              disabled={!input.trim()}
              className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
              title="Adicionar tag"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          {remaining.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {remaining.slice(0, 8).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => add(s)}
                  className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded-full text-[9.5px] font-medium border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
                >
                  <Plus className="w-2 h-2" /> {s}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {disabled && value.length === 0 && (
        <div className="text-[10px] text-muted-foreground/60 italic">Cadastrando contato…</div>
      )}
    </div>
  );
}
