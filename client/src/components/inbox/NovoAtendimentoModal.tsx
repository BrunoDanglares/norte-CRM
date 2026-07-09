// Bruno 2026-06-05: modal "Novo atendimento" — disparado pelo botão "+" da
// lista de conversas. Permite iniciar atendimento com 1..10 clientes por um
// canal escolhido, com mensagem livre OU template HSM (Meta).
//
// Fluxo "Iniciar":
//   • find-or-create da conversa de cada cliente (vinculada ao canal escolhido
//     via conexaoId → channel-router roteia a 1ª msg pelo canal certo);
//   • free-text  → POST /api/conversations/:id/messages (envio imediato);
//   • template   → POST /api/conversations/:id/send-template (Bruno 2026-06-24):
//     envia o HSM AGORA pela Meta, persiste a msg renderizada no chat e abre um
//     protocolo novo do atendimento. (Antes ia pelo /api/disparos-programados —
//     campanha em massa — que só enviava ~1min depois e NÃO aparecia no chat.)
//   • seleciona a 1ª conversa criada e fecha.
//
// "Lembrar canal" persiste o canal no localStorage e pré-seleciona na próxima.
import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import ContactAvatar from "@/components/ContactAvatar";
import {
  X, ChevronDown, Search, Check, Loader2, Send, FileText, Users,
} from "lucide-react";

const LS_CANAL = "flowcrm_novo_atend_canal";
const LS_LEMBRAR = "flowcrm_novo_atend_lembrar";
const MAX_CLIENTS = 10;

interface NovoAtendimentoModalProps {
  open: boolean;
  onClose: () => void;
  conexoesList: any[];
  contactsData: any[] | undefined;
  conversations: any[];
  onStarted: (firstConvId: number | null) => void;
}

interface ClientOpt { key: string; nome: string; telefone: string; fotoUrl?: string | null; }

export default function NovoAtendimentoModal({
  open, onClose, conexoesList, contactsData, conversations, onStarted,
}: NovoAtendimentoModalProps) {
  const { toast } = useToast();

  const [channelId, setChannelId] = useState<string | null>(null);
  const [channelOpen, setChannelOpen] = useState(false);
  const [rememberChannel, setRememberChannel] = useState(false);
  const [useTemplate, setUseTemplate] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [clientListOpen, setClientListOpen] = useState(false);
  const [selected, setSelected] = useState<ClientOpt[]>([]);
  const [message, setMessage] = useState("");
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [templateVars, setTemplateVars] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const clientBoxRef = useRef<HTMLDivElement>(null);
  const channelBoxRef = useRef<HTMLDivElement>(null);

  // Conexões conectadas primeiro.
  const channels = useMemo(() => {
    const list = (conexoesList || []).slice();
    list.sort((a: any, b: any) => (b.status === "connected" ? 1 : 0) - (a.status === "connected" ? 1 : 0));
    return list;
  }, [conexoesList]);
  const selectedChannel = channels.find((c: any) => c.id === channelId) || null;
  // Canal Meta (WhatsApp Oficial): conversa NOVA só inicia por template (janela
  // 24h). Texto livre só funciona dentro da janela (cliente falou < 24h).
  const isMetaChannel = selectedChannel?.provider === "meta";

  // Templates HSM aprovados (Meta) — só busca quando o checkbox tá ligado.
  const { data: tplResp, isLoading: tplLoading } = useQuery<any>({
    queryKey: ["/api/whatsapp-official/templates"],
    enabled: open && useTemplate,
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/whatsapp-official/templates");
      if (!r.ok) return { data: [] };
      return r.json();
    },
    staleTime: 60_000,
  });
  const templates: any[] = ((tplResp?.data || tplResp || []) as any[]).filter((t: any) => String(t.status).toUpperCase() === "APPROVED");
  const selectedTemplate = templates.find((t: any) => t.id === templateId) || null;

  // Opções de cliente: contatos + conversas (com telefone), dedup por telefone.
  const clientOptions = useMemo<ClientOpt[]>(() => {
    const fromContacts: ClientOpt[] = (contactsData || [])
      .filter((c: any) => c.telefone)
      .map((c: any) => ({ key: `ct-${c.id}`, nome: c.nome || "", telefone: String(c.telefone), fotoUrl: c.fotoUrl }));
    const fromConvs: ClientOpt[] = (conversations || [])
      .filter((c: any) => c.telefone)
      .map((c: any) => ({ key: `cv-${c.id}`, nome: c.nome || "", telefone: String(c.telefone), fotoUrl: (c as any).avatar }));
    const seen = new Set<string>();
    const out: ClientOpt[] = [];
    for (const o of [...fromContacts, ...fromConvs]) {
      const ph = o.telefone.replace(/\D/g, "");
      if (!ph) continue;
      const k = ph.slice(-8);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(o);
    }
    out.sort((a, b) => a.nome.localeCompare(b.nome));
    return out;
  }, [contactsData, conversations]);

  const filteredClients = useMemo(() => {
    const q = clientSearch.toLowerCase().trim();
    const selKeys = new Set(selected.map((s) => s.key));
    const qDigits = q.replace(/\D/g, "");
    return clientOptions
      .filter((o) => !selKeys.has(o.key))
      // Bruno 2026-06-08: bug — `string.includes("")` é sempre true, então ao
      // digitar texto (ex: "Bru") o qDigits virava "" e o match por telefone
      // casava com TODOS os contatos. Só compara telefone quando há dígitos.
      .filter((o) => !q || o.nome.toLowerCase().includes(q) || (!!qDigits && o.telefone.replace(/\D/g, "").includes(qDigits)))
      .slice(0, 50);
  }, [clientOptions, clientSearch, selected]);

  // Reset / pré-seleção ao abrir.
  useEffect(() => {
    if (!open) return;
    const lembrar = localStorage.getItem(LS_LEMBRAR) === "1";
    setRememberChannel(lembrar);
    const savedCanal = lembrar ? localStorage.getItem(LS_CANAL) : null;
    const conn = (conexoesList || []).filter((c: any) => c.status === "connected");
    setChannelId(savedCanal && conn.some((c: any) => c.id === savedCanal) ? savedCanal : (conn[0]?.id || null));
    setUseTemplate(false);
    setClientSearch("");
    setSelected([]);
    setMessage("");
    setTemplateId(null);
    setTemplateVars([]);
    setSubmitting(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ajusta nº de inputs de variável quando o template muda.
  useEffect(() => {
    const n = selectedTemplate?.variablesCount || 0;
    setTemplateVars((prev) => {
      const next = Array.from({ length: n }, (_, i) => prev[i] ?? "");
      return next;
    });
  }, [templateId, selectedTemplate?.variablesCount]);

  // Fecha dropdowns ao clicar fora.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (clientBoxRef.current && !clientBoxRef.current.contains(e.target as Node)) setClientListOpen(false);
      if (channelBoxRef.current && !channelBoxRef.current.contains(e.target as Node)) setChannelOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!open) return null;

  function addClient(o: ClientOpt) {
    if (selected.length >= MAX_CLIENTS) {
      toast({ title: `Máximo de ${MAX_CLIENTS} clientes`, variant: "destructive" });
      return;
    }
    setSelected((s) => [...s, o]);
    setClientSearch("");
    // Bruno 2026-06-08: fecha a lista ao escolher (antes ficava expandida pq a
    // condição de exibição cai em filteredClients.length > 0 mesmo com busca
    // vazia). Pra adicionar outro cliente, clicar no campo reabre.
    setClientListOpen(false);
  }
  function removeClient(key: string) {
    setSelected((s) => s.filter((x) => x.key !== key));
  }

  const canSubmit =
    !!channelId &&
    selected.length > 0 &&
    (useTemplate
      ? !!selectedTemplate && templateVars.every((v) => v.trim().length > 0)
      : message.trim().length > 0) &&
    !submitting;

  async function handleStart() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // Persiste preferência de canal.
      localStorage.setItem(LS_LEMBRAR, rememberChannel ? "1" : "0");
      if (rememberChannel && channelId) localStorage.setItem(LS_CANAL, channelId);
      else localStorage.removeItem(LS_CANAL);

      // 1) find-or-create de cada conversa (vinculada ao canal).
      const created: Array<{ convId: number; nome: string; telefone: string }> = [];
      let firstConvId: number | null = null;
      for (const cli of selected) {
        const r = await apiRequest("POST", "/api/conversations/find-or-create", {
          nome: cli.nome || cli.telefone,
          telefone: cli.telefone,
          canal: "whatsapp",
          conexaoId: channelId,
        });
        if (!r.ok) continue;
        const j = await r.json();
        const convId = j?.data?.id;
        if (convId) {
          created.push({ convId, nome: cli.nome, telefone: cli.telefone });
          if (firstConvId == null) firstConvId = convId;
          // Bruno 2026-06-05: o atendente que inicia já ASSUME a conversa — ela
          // nasce na coluna "Em Andamento" atribuída a ele (com a IA pausada),
          // em vez de cair na automação/fila. Best-effort (assume tem guards de
          // equipe; se falhar, o atendimento ainda inicia).
          try { await apiRequest("POST", `/api/conversations/${convId}/assume`, {}); } catch {}
        }
      }
      if (created.length === 0) throw new Error("Não consegui criar as conversas.");

      // 2) envio.
      if (useTemplate && selectedTemplate) {
        // Template HSM enviado AGORA por conversa (Meta), persistido no chat e
        // amarrado a um protocolo novo do atendimento. Bruno 2026-06-24: antes
        // ia pelo /api/disparos-programados (campanha em massa) — só enviava
        // ~1min depois via cron e NÃO aparecia no chat nem abria protocolo.
        const vars = templateVars.map((v, i) => ({ index: i + 1, kind: "fixed", value: v }));
        let firstErr: string | null = null;
        let sentCount = 0;
        for (const c of created) {
          const r = await apiRequest("POST", `/api/conversations/${c.convId}/send-template`, {
            templateName: selectedTemplate.templateName,
            templateLanguage: selectedTemplate.language || "pt_BR",
            templateVariables: vars,
          });
          if (r.ok) {
            sentCount++;
          } else {
            const e = await r.json().catch(() => ({}));
            if (!firstErr) firstErr = (e as any).message || "Falha ao enviar o template.";
          }
        }
        // Nenhum enviado → erro. Parcial → segue, mas avisa.
        if (sentCount === 0) throw new Error(firstErr || "Falha ao enviar o template.");
        if (firstErr) toast({ title: "Alguns templates falharam", description: firstErr, variant: "destructive" });
      } else {
        // Texto livre imediato por conversa.
        for (const c of created) {
          await apiRequest("POST", `/api/conversations/${c.convId}/messages`, {
            texto: message.trim(),
            direction: "out",
            tipo: "text",
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
      toast({
        title: "Atendimento iniciado 👌",
        description: `${created.length} cliente${created.length === 1 ? "" : "s"}${useTemplate ? " — template enviado" : ""}`,
      });
      onStarted(firstConvId);
      onClose();
    } catch (e: any) {
      toast({ title: "Erro ao iniciar", description: e?.message || "Erro inesperado", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-[1px]" onClick={onClose} data-testid="novo-atend-overlay" />
      <div
        className="fixed z-[201] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(540px,92vw)] max-h-[90vh] overflow-y-auto bg-card border border-border rounded-2xl shadow-2xl"
        data-testid="novo-atend-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border">
          <h3 className="text-[15px] font-bold">Novo atendimento</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors" data-testid="novo-atend-close" title="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Linha: Canais + Clientes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Canais */}
            <div>
              <label className="text-[12px] font-bold block mb-1.5">Canais</label>
              <div className="relative" ref={channelBoxRef}>
                <button
                  type="button"
                  onClick={() => setChannelOpen((v) => !v)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border bg-background text-[12.5px] hover:border-primary/40 transition-colors"
                  data-testid="novo-atend-canal"
                >
                  <span className={`flex items-center gap-1.5 min-w-0 ${selectedChannel ? "" : "text-muted-foreground"}`}>
                    {selectedChannel && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${selectedChannel.status === "connected" ? "bg-emerald-400" : "bg-red-400"}`} />}
                    <span className="truncate">{selectedChannel ? (selectedChannel.nome || selectedChannel.numero || "Conexão") : "Selecione um canal"}</span>
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground flex-shrink-0 transition-transform ${channelOpen ? "rotate-180" : ""}`} />
                </button>
                {channelOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-popover border border-border rounded-lg shadow-lg overflow-hidden max-h-[220px] overflow-y-auto">
                    {channels.length === 0 && <div className="px-3 py-2.5 text-[11.5px] text-muted-foreground">Nenhuma conexão.</div>}
                    {channels.map((c: any) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setChannelId(c.id); setChannelOpen(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-[12px] hover:bg-secondary/60 transition-colors ${channelId === c.id ? "bg-secondary/40 font-semibold" : ""}`}
                        data-testid={`novo-atend-canal-opt-${c.id}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.status === "connected" ? "bg-emerald-400" : "bg-red-400"}`} />
                        <span className="truncate flex-1 text-left">{c.nome || c.numero || "Conexão"}</span>
                        {c.numero && <span className="text-[10px] text-muted-foreground tabular-nums">{c.numero}</span>}
                        {channelId === c.id && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Checkboxes */}
              <label className="flex items-center gap-2 mt-2.5 text-[11.5px] cursor-pointer select-none">
                <input type="checkbox" checked={rememberChannel} onChange={(e) => setRememberChannel(e.target.checked)} className="accent-[hsl(var(--primary))] w-3.5 h-3.5" data-testid="novo-atend-lembrar" />
                Lembrar canal
              </label>
              <label className="flex items-center gap-2 mt-2 text-[11.5px] cursor-pointer select-none">
                <input type="checkbox" checked={useTemplate} onChange={(e) => setUseTemplate(e.target.checked)} className="accent-[hsl(var(--primary))] w-3.5 h-3.5" data-testid="novo-atend-template-toggle" />
                Enviar mensagem template
              </label>
            </div>

            {/* Clientes */}
            <div>
              <label className="text-[12px] font-bold block mb-1.5">Clientes</label>
              <div className="relative" ref={clientBoxRef}>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-background text-[12.5px] outline-none focus:border-primary/50"
                    placeholder="Buscar clientes"
                    value={clientSearch}
                    onChange={(e) => { setClientSearch(e.target.value); setClientListOpen(true); }}
                    onFocus={() => setClientListOpen(true)}
                    data-testid="novo-atend-cliente-search"
                  />
                </div>
                {clientListOpen && (clientSearch.length > 0 || filteredClients.length > 0) && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-popover border border-border rounded-lg shadow-lg overflow-hidden max-h-[220px] overflow-y-auto">
                    {filteredClients.length === 0 && <div className="px-3 py-2.5 text-[11.5px] text-muted-foreground">Nenhum cliente encontrado.</div>}
                    {filteredClients.map((o) => (
                      <button
                        key={o.key}
                        type="button"
                        onClick={() => addClient(o)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] hover:bg-secondary/60 transition-colors"
                        data-testid={`novo-atend-cliente-opt-${o.key}`}
                      >
                        <ContactAvatar nome={o.nome || "?"} fotoUrl={o.fotoUrl} size={26} rounded="50%" />
                        <div className="flex-1 text-left min-w-0">
                          <div className="truncate font-medium">{o.nome || "Sem nome"}</div>
                          <div className="text-[10px] text-muted-foreground tabular-nums">{o.telefone}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="text-[10.5px] text-muted-foreground mt-1.5">
                Selecione até {MAX_CLIENTS} clientes para iniciar o atendimento{selected.length > 0 ? ` · ${selected.length}/${MAX_CLIENTS}` : ""}
              </div>

              {/* Chips selecionados */}
              {selected.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {selected.map((s) => (
                    <span key={s.key} className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-full bg-secondary border border-border text-[11px]" data-testid={`novo-atend-chip-${s.key}`}>
                      <span className="max-w-[120px] truncate">{s.nome || s.telefone}</span>
                      <button type="button" onClick={() => removeClient(s.key)} className="w-4 h-4 rounded-full hover:bg-foreground/10 flex items-center justify-center text-muted-foreground" title="Remover">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Mensagem (texto livre) OU Template */}
          {!useTemplate ? (
            <div>
              <label className="text-[12px] font-bold block mb-1.5">Mensagem</label>
              <textarea
                className="w-full min-h-[110px] px-3 py-2 rounded-lg border border-border bg-background text-[13px] outline-none focus:border-primary/50 resize-y"
                placeholder="Escreva a mensagem que vai iniciar o atendimento…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                data-testid="novo-atend-mensagem"
              />
              {isMetaChannel && (
                <div className="mt-1.5 text-[10.5px] text-amber-600 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1.5 leading-snug" data-testid="novo-atend-meta-warn">
                  ⚠️ Canal <b>WhatsApp Oficial</b>: conversa nova só pode ser iniciada por <b>template</b> (janela de 24h da Meta). Marque <b>“Enviar mensagem template”</b> — texto livre só chega se o cliente falou nas últimas 24h.
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-[12px] font-bold flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Template (WhatsApp Oficial)</label>
              {tplLoading ? (
                <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando templates…</div>
              ) : templates.length === 0 ? (
                <div className="text-[11.5px] text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2.5">
                  Nenhum template aprovado. O envio de template exige uma conexão <b>WhatsApp Oficial (Meta)</b> com template aprovado.
                </div>
              ) : (
                <>
                  <select
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-[12.5px] outline-none focus:border-primary/50"
                    value={templateId ?? ""}
                    onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : null)}
                    data-testid="novo-atend-template-select"
                  >
                    <option value="">Selecione um template…</option>
                    {templates.map((t: any) => (
                      <option key={t.id} value={t.id}>{t.templateName} ({t.language})</option>
                    ))}
                  </select>
                  {selectedTemplate && (
                    <div className="text-[11.5px] text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2 whitespace-pre-wrap">
                      {selectedTemplate.bodyText}
                    </div>
                  )}
                  {templateVars.map((v, i) => (
                    <input
                      key={i}
                      className="w-full px-3 py-1.5 rounded-lg border border-border bg-background text-[12px] outline-none focus:border-primary/50"
                      placeholder={`Variável {{${i + 1}}}`}
                      value={v}
                      onChange={(e) => setTemplateVars((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))}
                      data-testid={`novo-atend-tplvar-${i}`}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border">
          <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 rounded-lg text-[12.5px] font-medium border border-border bg-secondary hover:bg-secondary/70 transition-colors disabled:opacity-50" data-testid="novo-atend-cancelar">
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleStart}
            disabled={!canSubmit}
            className="px-4 py-2 rounded-lg text-[12.5px] font-semibold bg-primary text-primary-content hover:bg-primary/90 inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
            data-testid="novo-atend-iniciar"
          >
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Iniciar atendimento
          </button>
        </div>
      </div>
    </>
  );
}
