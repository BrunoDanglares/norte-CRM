import { useEffect, useMemo, useState } from "react";
import { UseMutationResult } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useToast } from "@/hooks/use-toast";
import { getInitials } from "@/lib/constants";
import { agentColor, type ConvExtended } from "./helpers";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronDown, Users, X, Loader2 } from "lucide-react";

// Bruno 2026-05-19: redesign do modal de transferência pra match o print
// solicitado (tabs Atendente/Departamento + textareas msg interna/cliente).
// Substitui versão anterior que era uma lista expandível em accordion.

const TEAM_COLORS: Record<string, string> = {
  Comercial: "#059669",
  Vendas: "#059669",
  Financeiro: "#d97706",
  Suporte: "#2563eb",
  "Suporte Técnico": "#2563eb",
  "Suporte Tecnico": "#2563eb",
  Cancelamento: "#dc2626",
  Retenção: "#dc2626",
  Retencao: "#dc2626",
};
const teamColor = (name?: string) => (name && TEAM_COLORS[name]) || "#8b5cf6";

const DEFAULT_CLIENT_MSG =
  "Estou direcionando você para o @chat_transferido_para. Será rápido 🚀 e você será atendido em breve 😊!";

interface TransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: ConvExtended | null;
  equipesList: any[];
  usuariosList: any[];
  assignMutation: UseMutationResult<any, any, any, any>;
}

export default function TransferDialog({
  open,
  onOpenChange,
  selected,
  equipesList,
  usuariosList,
  assignMutation,
}: TransferDialogProps) {
  const { toast } = useToast();

  // Tab atual — default "atendente" como no print
  const [mode, setMode] = useState<"atendente" | "departamento">("atendente");

  // Atendente
  const [onlyOnline, setOnlyOnline] = useState(true);
  const [agentPopoverOpen, setAgentPopoverOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);

  // Departamento
  const [deptPopoverOpen, setDeptPopoverOpen] = useState(false);
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);

  // Mensagens
  const [internalMsg, setInternalMsg] = useState("");
  const [clientMsg, setClientMsg] = useState(DEFAULT_CLIENT_MSG);

  const [submitting, setSubmitting] = useState(false);

  // Reset ao abrir/fechar
  useEffect(() => {
    if (!open) return;
    setMode("atendente");
    setOnlyOnline(true);
    setSelectedAgentId(null);
    setSelectedDeptId(null);
    setInternalMsg("");
    setClientMsg(DEFAULT_CLIENT_MSG);
    setAgentPopoverOpen(false);
    setDeptPopoverOpen(false);
  }, [open]);

  // Resolve a equipe atual da conversa pra escopar a lista de atendentes.
  // Prioridade: assignedTeamId (atribuição explícita) → pipeline da conv batendo
  // com pipelineKey da equipe (fallback). Se nenhum dos dois resolver, lista
  // fica sem escopo de setor (mostra todos) — só acontece em conv solta sem
  // departamento atribuído.
  const conversationTeam = useMemo(() => {
    if (!selected) return null;
    const assignedId = (selected as any).assignedTeamId;
    if (assignedId) {
      const byId = (equipesList || []).find((e: any) => e.id === assignedId);
      if (byId) return byId;
    }
    const pipe = ((selected as any).pipeline || "").toString().toLowerCase();
    if (pipe) {
      const byPipe = (equipesList || []).find(
        (e: any) => (e.pipelineKey || "").toString().toLowerCase() === pipe,
      );
      if (byPipe) return byPipe;
    }
    return null;
  }, [selected, equipesList]);

  // Listas filtradas. Bruno 2026-05-19: aba "Atendente" mostra SÓ quem é do
  // mesmo setor da conversa. Pra mudar de setor, atendente deve usar a aba
  // "Departamento" — separação intencional pra evitar transferência
  // cross-setor por engano (perde fila/SLA/pipeline da equipe original).
  const atendentes = useMemo(() => {
    const active = (usuariosList || []).filter((u: any) => u.status === "ACTIVE");
    let scoped = active;
    if (conversationTeam?.nome) {
      const teamName = conversationTeam.nome.toLowerCase();
      scoped = active.filter((u: any) =>
        (u.equipes || []).some((eqNome: string) =>
          (eqNome || "").toLowerCase() === teamName,
        ),
      );
    }
    if (!onlyOnline) return scoped;
    return scoped.filter((u: any) => u.online === true);
  }, [usuariosList, onlyOnline, conversationTeam]);

  const selectedAgent = useMemo(
    () => (usuariosList || []).find((u: any) => u.id === selectedAgentId) || null,
    [usuariosList, selectedAgentId],
  );
  const selectedDept = useMemo(
    () => (equipesList || []).find((e: any) => e.id === selectedDeptId) || null,
    [equipesList, selectedDeptId],
  );

  // Resolve placeholder @chat_transferido_para → nome real do alvo
  const resolveClientMsg = (msg: string): string => {
    const targetName =
      mode === "atendente"
        ? selectedAgent?.nome || ""
        : selectedDept?.nome || "";
    if (!targetName) return msg;
    return msg.replace(/@chat_transferido_para/g, targetName);
  };

  const canSubmit =
    !!selected &&
    !submitting &&
    ((mode === "atendente" && !!selectedAgent) ||
      (mode === "departamento" && !!selectedDept));

  const handleTransfer = async () => {
    if (!selected || !canSubmit) return;
    setSubmitting(true);
    try {
      // 1. Mensagem pro cliente (opcional — só envia se preenchida)
      const clientMsgFinal = clientMsg.trim() ? resolveClientMsg(clientMsg.trim()) : "";
      if (clientMsgFinal) {
        try {
          await apiRequest("POST", `/api/conversations/${selected.id}/messages`, {
            texto: clientMsgFinal,
            direction: "out",
            tipo: "text",
            status: "sent",
          });
        } catch (e: any) {
          // Falha não-fatal: avisa mas continua a transferência
          console.warn("[TransferDialog] falha ao enviar msg pro cliente:", e?.message);
        }
      }

      // 2. Nota interna (opcional) — usa direction='internal' (não vai pro cliente)
      const internalFinal = internalMsg.trim();
      if (internalFinal) {
        try {
          await apiRequest("POST", `/api/conversations/${selected.id}/messages`, {
            texto: internalFinal,
            direction: "internal",
            tipo: "text",
            status: "sent",
          });
        } catch (e: any) {
          console.warn("[TransferDialog] falha ao registrar nota interna:", e?.message);
        }
      }

      // 3. Transferência efetiva
      if (mode === "departamento" && selectedDept) {
        const res = await apiRequest("POST", `/api/conversations/${selected.id}/transfer-team`, {
          team_id: selectedDept.id,
          team_name: selectedDept.nome,
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error((d as any).error || "Erro ao transferir");
        }
        queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
        toast({ title: "Transferido", description: `Conversa transferida para ${selectedDept.nome}` });
      } else if (mode === "atendente" && selectedAgent) {
        // Atendente: descobre a equipe principal do usuário pra setar `agente` correto
        const userTeam =
          (selectedAgent.equipes && selectedAgent.equipes[0]) ||
          (selectedAgent.cargo || "");
        const agenteLabel = userTeam ? `[Equipe] ${userTeam}` : selectedAgent.nome;
        await assignMutation.mutateAsync({
          convId: selected.id,
          agente: agenteLabel,
          targetUserId: selectedAgent.id,
        });
        toast({ title: "Transferido", description: `Conversa transferida para ${selectedAgent.nome}` });
      }

      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Erro", description: err.message || "Falha ao transferir", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (!selected) return null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* z-[80] > Drawer overlay (z-60) e content (z-70) do ConversaDrawer.
            Garante que o modal apareça em cima quando aberto de dentro do drawer. */}
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="dialog-center-fix fixed z-[81] grid w-full sm:max-w-[440px] max-h-[90vh] overflow-hidden gap-0 border bg-card shadow-2xl rounded-xl outline-none p-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          data-testid="transfer-dialog"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4">
            <DialogPrimitive.Title className="text-[15px] font-semibold leading-tight">
              Transferir atendimento para
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Fechar"
            >
              <X className="w-4 h-4" />
            </DialogPrimitive.Close>
          </div>

          {/* Tabs Atendente / Departamento — pílula seg-tab (redesign Norte).
              Antes: shadcn Tabs (único do projeto). */}
          <div className="px-5 pb-5 flex justify-end">
            <div className="inline-flex gap-1" role="tablist">
              <button
                type="button"
                onClick={() => setMode("atendente")}
                className={`seg-tab ${mode === "atendente" ? "seg-tab-active" : ""}`}
                data-testid="tab-atendente"
              >
                Atendente
              </button>
              <button
                type="button"
                onClick={() => setMode("departamento")}
                className={`seg-tab ${mode === "departamento" ? "seg-tab-active" : ""}`}
                data-testid="tab-departamento"
              >
                Departamento
              </button>
            </div>
          </div>

          <div className="px-5 pb-4 space-y-4 overflow-y-auto">
            {/* Tab Atendente */}
            {mode === "atendente" && (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[12.5px] font-medium text-foreground/90">
                      Atendentes
                      {conversationTeam?.nome && (
                        <span
                          className="ml-1.5 inline-flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-0.5 rounded"
                          style={{
                            background: `${teamColor(conversationTeam.nome)}1f`,
                            color: teamColor(conversationTeam.nome),
                          }}
                        >
                          {conversationTeam.nome}
                        </span>
                      )}
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-[11.5px] text-muted-foreground">Somente Online</span>
                      <Switch
                        checked={onlyOnline}
                        onCheckedChange={setOnlyOnline}
                        data-testid="switch-only-online"
                      />
                    </div>
                  </div>
                  {conversationTeam?.nome && (
                    <p className="text-[10.5px] text-muted-foreground leading-tight">
                      Listando apenas atendentes do setor. Pra mudar de departamento, use a aba <span className="font-medium">Departamento</span>.
                    </p>
                  )}

                  <Popover open={agentPopoverOpen} onOpenChange={setAgentPopoverOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="w-full flex items-center justify-between gap-2 h-10 px-3 rounded-md border border-border bg-background hover:bg-secondary/40 transition-colors text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        data-testid="agent-combobox-trigger"
                      >
                        {selectedAgent ? (
                          <div className="flex items-center gap-2 min-w-0">
                            <div
                              className="w-6 h-6 rounded-full inline-flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 relative"
                              style={{ backgroundColor: agentColor(selectedAgent.nome) }}
                            >
                              {getInitials(selectedAgent.nome)}
                              {selectedAgent.online && (
                                <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-card" />
                              )}
                            </div>
                            <span className="text-[12.5px] font-medium truncate">{selectedAgent.nome}</span>
                          </div>
                        ) : (
                          <span className="text-[12.5px] text-muted-foreground">Buscar atendentes</span>
                        )}
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="p-0 w-[var(--radix-popover-trigger-width)] z-[82]"
                      align="start"
                    >
                      <Command>
                        <CommandInput placeholder="Buscar atendentes..." className="text-[12.5px]" />
                        <CommandList>
                          <CommandEmpty className="py-6 px-3 text-center text-[12px] text-muted-foreground leading-relaxed">
                            {conversationTeam?.nome
                              ? onlyOnline
                                ? `Nenhum atendente de ${conversationTeam.nome} online`
                                : `Nenhum atendente em ${conversationTeam.nome}`
                              : onlyOnline
                                ? "Nenhum atendente online"
                                : "Nenhum atendente encontrado"}
                          </CommandEmpty>
                          <CommandGroup>
                            {atendentes.map((u: any) => (
                              <CommandItem
                                key={u.id}
                                value={`${u.nome} ${u.email || ""}`}
                                onSelect={() => {
                                  setSelectedAgentId(u.id);
                                  setAgentPopoverOpen(false);
                                }}
                                className="gap-2 cursor-pointer"
                                data-testid={`agent-option-${u.id}`}
                              >
                                <div
                                  className="w-6 h-6 rounded-full inline-flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 relative"
                                  style={{ backgroundColor: agentColor(u.nome) }}
                                >
                                  {getInitials(u.nome)}
                                  {u.online && (
                                    <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-popover" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[12.5px] font-medium truncate">{u.nome}</div>
                                  {u.email && (
                                    <div className="text-[10.5px] text-muted-foreground truncate">{u.email}</div>
                                  )}
                                </div>
                                {selectedAgentId === u.id && (
                                  <Check className="w-3.5 h-3.5 flex-shrink-0" />
                                )}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              </>
            )}

            {/* Tab Departamento */}
            {mode === "departamento" && (
              <div className="space-y-1.5">
                <label className="text-[12.5px] font-medium text-foreground/90">Departamento</label>
                <Popover open={deptPopoverOpen} onOpenChange={setDeptPopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="w-full flex items-center justify-between gap-2 h-10 px-3 rounded-md border border-border bg-background hover:bg-secondary/40 transition-colors text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      data-testid="dept-combobox-trigger"
                    >
                      {selectedDept ? (
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className="w-6 h-6 rounded-md inline-flex items-center justify-center flex-shrink-0"
                            style={{ background: `${teamColor(selectedDept.nome)}1f` }}
                          >
                            <Users className="w-3 h-3" style={{ color: teamColor(selectedDept.nome) }} />
                          </div>
                          <span
                            className="text-[12.5px] font-medium truncate"
                            style={{ color: teamColor(selectedDept.nome) }}
                          >
                            {selectedDept.nome}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[12.5px] text-muted-foreground">Buscar departamento</span>
                      )}
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="p-0 w-[var(--radix-popover-trigger-width)] z-[82]"
                    align="start"
                  >
                    <Command>
                      <CommandInput placeholder="Buscar departamento..." className="text-[12.5px]" />
                      <CommandList>
                        <CommandEmpty className="py-6 text-center text-[12px] text-muted-foreground">
                          Nenhum departamento encontrado
                        </CommandEmpty>
                        <CommandGroup>
                          {(equipesList || []).map((eq: any) => {
                            const c = teamColor(eq.nome);
                            const memberCount = (eq.members || []).length;
                            return (
                              <CommandItem
                                key={eq.id}
                                value={eq.nome}
                                onSelect={() => {
                                  setSelectedDeptId(eq.id);
                                  setDeptPopoverOpen(false);
                                }}
                                className="gap-2 cursor-pointer"
                                data-testid={`dept-option-${eq.id}`}
                              >
                                <div
                                  className="w-6 h-6 rounded-md inline-flex items-center justify-center flex-shrink-0"
                                  style={{ background: `${c}1f` }}
                                >
                                  <Users className="w-3 h-3" style={{ color: c }} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[12.5px] font-medium truncate" style={{ color: c }}>
                                    {eq.nome}
                                  </div>
                                  <div className="text-[10.5px] text-muted-foreground">
                                    {memberCount} {memberCount === 1 ? "atendente" : "atendentes"}
                                  </div>
                                </div>
                                {selectedDeptId === eq.id && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            )}

            {/* Mensagem interna */}
            <div className="space-y-1.5">
              <label className="text-[12.5px] font-medium text-foreground/90">Mensagem interna</label>
              <Textarea
                value={internalMsg}
                onChange={(e) => setInternalMsg(e.target.value)}
                placeholder="Comunique, por exemplo, o motivo da transferência. Essa mensagem não é enviada ao cliente!"
                className="min-h-[64px] text-[12px] resize-none placeholder:text-muted-foreground/70"
                data-testid="textarea-internal"
              />
            </div>

            {/* Mensagem pro cliente */}
            <div className="space-y-1.5">
              <label className="text-[12.5px] font-medium text-foreground/90">Mensagem para o cliente</label>
              <Textarea
                value={clientMsg}
                onChange={(e) => setClientMsg(e.target.value)}
                placeholder="Estou direcionando você para o @chat_transferido_para..."
                className="min-h-[64px] text-[12px] resize-none placeholder:text-muted-foreground/70"
                data-testid="textarea-client"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-border/70 flex items-center justify-end gap-2 bg-card">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              data-testid="btn-cancelar"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleTransfer}
              disabled={!canSubmit}
              data-testid="btn-transferir"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Transferindo...
                </>
              ) : (
                "Transferir"
              )}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
