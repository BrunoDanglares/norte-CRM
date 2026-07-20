// ═══════════════════════════════════════════════════════════════════════════
// Agenda (Fase 1) — painel de agendamentos multi-segmento (clínica, laboratório,
// consultório, barbearia…). Abas: Agenda visual (dia, colunas por profissional) +
// Serviços + Profissionais (com disponibilidade) + Folgas. Canal público (link
// estilo Calendly) vem na Fase 2; lembretes WhatsApp na Fase 3.
//
// Tempo: os horários são "relógio de parede" guardados como UTC-naive (ver
// server/services/agendaService.ts). No front, SEMPRE formatamos com timeZone:"UTC"
// e construímos ISO via Date.UTC — assim o dígito 14:00 vai e volta intacto. Bruno 2026-07-11.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  CalendarDays, Plus, ChevronLeft, ChevronRight, Clock, Trash2, Pencil,
  Users, Briefcase, CalendarOff, Loader2,
} from "lucide-react";

// ── Helpers de tempo (relógio de parede como UTC) ────────────────────────────
const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const DIAS_CURTO = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const pad2 = (n: number) => String(n).padStart(2, "0");
function hojeStr(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); // YYYY-MM-DD
}
function addDias(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}
function diaSemanaDe(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function dayBoundsISO(dateStr: string): { inicio: string; fim: string } {
  return { inicio: `${dateStr}T00:00:00.000Z`, fim: `${addDias(dateStr, 1)}T00:00:00.000Z` };
}
function fmtHora(iso: string): string {
  try { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }); }
  catch { return ""; }
}
function fmtDataLonga(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" });
}
function minutosDeISO(iso: string): number { const dt = new Date(iso); return dt.getUTCHours() * 60 + dt.getUTCMinutes(); }
function precoBR(centavos: number | null | undefined): string {
  if (centavos == null) return "—";
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const STATUS_META: Record<string, { label: string; cor: string }> = {
  pendente: { label: "Pendente", cor: "#f59e0b" },
  confirmado: { label: "Confirmado", cor: "#16a34a" },
  concluido: { label: "Concluído", cor: "#3b82f6" },
  cancelado: { label: "Cancelado", cor: "#ef4444" },
  faltou: { label: "Faltou", cor: "#6b7280" },
};
const CORES = ["#7c3aed", "#2563eb", "#16a34a", "#f59e0b", "#ef4444", "#0ea5e9", "#db2777", "#65a30d", "#9333ea", "#0d9488"];

export default function AgendaPage() {
  const [tab, setTab] = useState("agenda");
  const { data: servicos = [] } = useQuery<any[]>({ queryKey: ["/api/agenda/servicos"] });
  const { data: profissionais = [] } = useQuery<any[]>({ queryKey: ["/api/agenda/profissionais"] });
  const servicosAtivos = useMemo(() => servicos.filter((s) => s.ativo), [servicos]);
  const profsAtivos = useMemo(() => profissionais.filter((p) => p.ativo), [profissionais]);

  return (
    <div className="max-w-[1200px] mx-auto space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary grid place-items-center"><CalendarDays className="w-5 h-5" /></div>
        <div>
          <h1 className="text-lg font-semibold leading-tight">Agenda</h1>
          <p className="text-[12px] text-muted-foreground">Agendamentos de serviços — clínicas, consultórios, laboratórios, barbearias…</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="agenda"><CalendarDays className="w-3.5 h-3.5 mr-1.5" />Agenda</TabsTrigger>
          <TabsTrigger value="servicos"><Briefcase className="w-3.5 h-3.5 mr-1.5" />Serviços</TabsTrigger>
          <TabsTrigger value="profissionais"><Users className="w-3.5 h-3.5 mr-1.5" />Profissionais</TabsTrigger>
          <TabsTrigger value="folgas"><CalendarOff className="w-3.5 h-3.5 mr-1.5" />Folgas</TabsTrigger>
        </TabsList>

        <TabsContent value="agenda" className="mt-4">
          <AgendaVisual servicos={servicosAtivos} profissionais={profsAtivos} />
        </TabsContent>
        <TabsContent value="servicos" className="mt-4">
          <ServicosTab servicos={servicos} profissionais={profsAtivos} />
        </TabsContent>
        <TabsContent value="profissionais" className="mt-4">
          <ProfissionaisTab profissionais={profissionais} servicos={servicosAtivos} />
        </TabsContent>
        <TabsContent value="folgas" className="mt-4">
          <FolgasTab profissionais={profsAtivos} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════ AGENDA VISUAL (dia) ═══════════════════════════
const GRID_START = 7 * 60;   // 07:00
const GRID_END = 22 * 60;    // 22:00
const PX_H = 56;             // px por hora
const PXM = PX_H / 60;
const GRID_H = ((GRID_END - GRID_START) / 60) * PX_H;

function AgendaVisual({ servicos, profissionais }: { servicos: any[]; profissionais: any[] }) {
  const [data, setData] = useState(hojeStr());
  const [dialog, setDialog] = useState<{ open: boolean; edit?: any; presetProf?: number }>({ open: false });
  const bounds = dayBoundsISO(data);
  const qc = useQueryClient();
  const { data: ags = [], isLoading } = useQuery<any[]>({
    queryKey: [`/api/agenda/agendamentos?inicio=${bounds.inicio}&fim=${bounds.fim}`],
  });
  const invalidate = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey?.[0] || "").startsWith("/api/agenda/agendamentos") });

  const horas = useMemo(() => { const a: number[] = []; for (let h = GRID_START / 60; h <= GRID_END / 60; h++) a.push(h); return a; }, []);
  const colProfs = profissionais.length ? profissionais : [];

  return (
    <div className="space-y-3">
      {/* Barra de navegação */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setData((d) => addDias(d, -1))}><ChevronLeft className="w-4 h-4" /></Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => setData(hojeStr())}>Hoje</Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setData((d) => addDias(d, 1))}><ChevronRight className="w-4 h-4" /></Button>
        </div>
        <Input type="date" value={data} onChange={(e) => setData(e.target.value || hojeStr())} className="h-8 w-[150px]" />
        <span className="text-[13px] text-muted-foreground capitalize hidden sm:inline">{fmtDataLonga(data)}</span>
        <Button size="sm" className="h-8 ml-auto" onClick={() => setDialog({ open: true })} disabled={!servicos.length || !profissionais.length}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />Novo agendamento
        </Button>
      </div>

      {(!servicos.length || !profissionais.length) && (
        <Card className="p-4 text-[13px] text-muted-foreground">
          Pra começar, cadastre {(!servicos.length && !profissionais.length) ? "serviços e profissionais" : !servicos.length ? "um serviço" : "um profissional"} nas abas acima.
        </Card>
      )}

      {colProfs.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <div className="flex min-w-max">
              {/* Gutter de horas */}
              <div className="flex-none w-12 border-r border-border pt-[34px]" style={{ height: GRID_H + 34 }}>
                {horas.map((h) => (
                  <div key={h} className="relative text-[10px] text-muted-foreground text-right pr-1.5" style={{ height: PX_H }}>
                    <span className="absolute -top-1.5 right-1.5">{pad2(h)}:00</span>
                  </div>
                ))}
              </div>
              {/* Colunas por profissional */}
              {colProfs.map((prof) => {
                const doDia = ags.filter((a) => a.profissionalId === prof.id);
                return (
                  <div key={prof.id} className="flex-none w-[180px] border-r border-border last:border-r-0">
                    <div className="h-[34px] px-2 flex items-center gap-1.5 border-b border-border bg-muted/40 sticky top-0">
                      <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: prof.cor || "#7c3aed" }} />
                      <span className="text-[12px] font-medium truncate">{prof.nome}</span>
                    </div>
                    <div className="relative cursor-pointer" style={{ height: GRID_H }} onClick={() => setDialog({ open: true, presetProf: prof.id })}>
                      {/* linhas de hora */}
                      {horas.map((h) => (<div key={h} className="absolute left-0 right-0 border-t border-border/60" style={{ top: (h * 60 - GRID_START) * PXM }} />))}
                      {/* blocos */}
                      {doDia.map((a) => {
                        const ini = minutosDeISO(a.inicio), fim = minutosDeISO(a.fim);
                        const top = Math.max(0, (ini - GRID_START) * PXM);
                        const h = Math.max(20, (fim - ini) * PXM - 2);
                        const cor = a.servicoCor || prof.cor || "#7c3aed";
                        const cancelado = a.status === "cancelado";
                        return (
                          <button
                            key={a.id}
                            onClick={(e) => { e.stopPropagation(); setDialog({ open: true, edit: a }); }}
                            className="absolute left-1 right-1 rounded-md px-1.5 py-0.5 text-left overflow-hidden shadow-sm border"
                            style={{ top, height: h, background: cancelado ? "transparent" : `${cor}22`, borderColor: cor, opacity: cancelado ? 0.5 : 1, textDecoration: cancelado ? "line-through" : "none" }}
                            title={`${fmtHora(a.inicio)} ${a.clienteNome} — ${a.servicoNome || ""}`}
                          >
                            <div className="text-[10.5px] font-semibold leading-tight truncate" style={{ color: cor }}>{fmtHora(a.inicio)} {a.clienteNome}</div>
                            {h > 30 && <div className="text-[9.5px] text-muted-foreground truncate">{a.servicoNome}</div>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {isLoading && <p className="text-[12px] text-muted-foreground text-center py-2">Carregando…</p>}

      {dialog.open && (
        <AppointmentDialog
          servicos={servicos} profissionais={profissionais}
          data={data} edit={dialog.edit} presetProf={dialog.presetProf}
          onClose={() => setDialog({ open: false })}
          onSaved={() => { setDialog({ open: false }); invalidate(); }}
        />
      )}
    </div>
  );
}

// ── Dialog de novo/editar agendamento (com motor de slots) ───────────────────
function AppointmentDialog({ servicos, profissionais, data, edit, presetProf, onClose, onSaved }: {
  servicos: any[]; profissionais: any[]; data: string; edit?: any; presetProf?: number; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const isEdit = !!edit;
  const [servicoId, setServicoId] = useState<string>(edit ? String(edit.servicoId) : (servicos[0] ? String(servicos[0].id) : ""));
  const [profId, setProfId] = useState<string>(edit ? String(edit.profissionalId) : (presetProf ? String(presetProf) : ""));
  const [dataSel, setDataSel] = useState<string>(edit ? new Date(edit.inicio).toISOString().slice(0, 10) : data);
  const [slotISO, setSlotISO] = useState<string>(edit ? edit.inicio : "");
  const [nome, setNome] = useState(edit?.clienteNome || "");
  const [telefone, setTelefone] = useState(edit?.clienteTelefone || "");
  const [obs, setObs] = useState(edit?.observacoes || "");
  const [status, setStatus] = useState(edit?.status || "confirmado");
  const [salvando, setSalvando] = useState(false);

  // Profissionais elegíveis pro serviço escolhido (fallback: todos, se sem vínculo).
  const elegiveis = useMemo(() => {
    const sid = Number(servicoId);
    const linkados = profissionais.filter((p) => (p.servicoIds || []).includes(sid));
    return linkados.length ? linkados : profissionais;
  }, [servicoId, profissionais]);

  // Se o profissional atual não atende o serviço, reseta.
  useEffect(() => {
    if (profId && !elegiveis.some((p) => String(p.id) === profId)) setProfId("");
  }, [servicoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const podeCarregarSlots = !!servicoId && !!profId && !!dataSel;
  const { data: slotsData, isFetching: carregandoSlots } = useQuery<any>({
    queryKey: [`/api/agenda/slots?profissionalId=${profId}&servicoId=${servicoId}&data=${dataSel}`],
    enabled: podeCarregarSlots,
  });
  const slots: any[] = slotsData?.slots || [];

  async function salvar() {
    if (!servicoId || !profId) return toast({ title: "Escolha serviço e profissional", variant: "destructive" });
    if (!nome.trim()) return toast({ title: "Informe o nome do cliente", variant: "destructive" });
    if (!slotISO) return toast({ title: "Escolha um horário", variant: "destructive" });
    setSalvando(true);
    try {
      if (isEdit) {
        await apiRequest("PATCH", `/api/agenda/agendamentos/${edit.id}`, {
          servicoId: Number(servicoId), profissionalId: Number(profId), inicio: slotISO,
          clienteNome: nome.trim(), clienteTelefone: telefone.trim() || null, observacoes: obs, status,
        });
      } else {
        await apiRequest("POST", "/api/agenda/agendamentos", {
          servicoId: Number(servicoId), profissionalId: Number(profId), inicio: slotISO,
          clienteNome: nome.trim(), clienteTelefone: telefone.trim() || null, observacoes: obs, origem: "manual",
        });
      }
      toast({ title: isEdit ? "Agendamento atualizado" : "Agendamento criado" });
      onSaved();
    } catch (e: any) {
      let msg = "Erro ao salvar"; try { const j = String(e?.message || "").match(/\{[\s\S]*\}/); if (j) msg = JSON.parse(j[0]).error || msg; } catch {}
      toast({ title: msg, variant: "destructive" });
    } finally { setSalvando(false); }
  }

  async function mudarStatus(novo: string) {
    setStatus(novo);
    if (!isEdit) return;
    try { await apiRequest("PATCH", `/api/agenda/agendamentos/${edit.id}`, { status: novo }); toast({ title: "Status atualizado" }); onSaved(); }
    catch { toast({ title: "Erro ao mudar status", variant: "destructive" }); }
  }

  async function excluir() {
    if (!isEdit || !confirm("Excluir este agendamento?")) return;
    try { await apiRequest("DELETE", `/api/agenda/agendamentos/${edit.id}`); toast({ title: "Agendamento excluído" }); onSaved(); }
    catch { toast({ title: "Erro ao excluir", variant: "destructive" }); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isEdit ? "Agendamento" : "Novo agendamento"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[12px]">Serviço</Label>
              <Select value={servicoId} onValueChange={(v) => { setServicoId(v); setSlotISO(""); }}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Escolha" /></SelectTrigger>
                <SelectContent>{servicos.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.nome} · {s.duracaoMin}min</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[12px]">Profissional</Label>
              <Select value={profId} onValueChange={(v) => { setProfId(v); setSlotISO(""); }}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Escolha" /></SelectTrigger>
                <SelectContent>{elegiveis.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-[12px]">Data</Label>
            <Input type="date" value={dataSel} onChange={(e) => { setDataSel(e.target.value); setSlotISO(""); }} className="mt-1" />
          </div>

          <div>
            <Label className="text-[12px]">Horário {carregandoSlots && <Loader2 className="w-3 h-3 inline animate-spin ml-1" />}</Label>
            {!podeCarregarSlots ? (
              <p className="text-[11.5px] text-muted-foreground mt-1">Escolha serviço, profissional e data pra ver os horários.</p>
            ) : slots.length === 0 && !carregandoSlots ? (
              <p className="text-[11.5px] text-muted-foreground mt-1">Sem horários livres nesse dia (confira a disponibilidade do profissional).</p>
            ) : (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {isEdit && slotISO && !slots.some((s) => s.inicio === slotISO) && (
                  <button className="px-2.5 py-1 rounded-md text-[12px] border border-primary bg-primary text-primary-content">{fmtHora(slotISO)} (atual)</button>
                )}
                {slots.map((s) => (
                  <button key={s.inicio} onClick={() => setSlotISO(s.inicio)}
                    className={`px-2.5 py-1 rounded-md text-[12px] border transition-colors ${slotISO === s.inicio ? "border-primary bg-primary text-primary-content" : "border-border hover:bg-muted"}`}>
                    {s.hora}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-[12px]">Cliente</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} className="mt-1" placeholder="Nome" /></div>
            <div><Label className="text-[12px]">WhatsApp</Label><Input value={telefone} onChange={(e) => setTelefone(e.target.value)} className="mt-1" placeholder="(00) 00000-0000" /></div>
          </div>
          <div><Label className="text-[12px]">Observações</Label><Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} className="mt-1" /></div>

          {isEdit && (
            <div>
              <Label className="text-[12px]">Status</Label>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {Object.entries(STATUS_META).map(([k, v]) => (
                  <button key={k} onClick={() => mudarStatus(k)}
                    className="px-2.5 py-1 rounded-md text-[12px] border transition-colors"
                    style={status === k ? { background: v.cor, borderColor: v.cor, color: "#fff" } : { borderColor: "var(--border)" }}>
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          {isEdit && <Button variant="ghost" size="sm" className="text-red-500 mr-auto" onClick={excluir}><Trash2 className="w-3.5 h-3.5 mr-1" />Excluir</Button>}
          <Button variant="outline" size="sm" onClick={onClose}>Fechar</Button>
          <Button size="sm" onClick={salvar} disabled={salvando}>{salvando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (isEdit ? "Salvar" : "Agendar")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════ SERVIÇOS ═══════════════════════════════════
function ServicosTab({ servicos, profissionais }: { servicos: any[]; profissionais: any[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ open: boolean; edit?: any }>({ open: false });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/agenda/servicos"] });

  async function arquivar(s: any) {
    if (!confirm(`Arquivar o serviço "${s.nome}"?`)) return;
    try { await apiRequest("DELETE", `/api/agenda/servicos/${s.id}`); toast({ title: "Serviço arquivado" }); invalidate(); }
    catch { toast({ title: "Erro ao arquivar", variant: "destructive" }); }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button size="sm" onClick={() => setDialog({ open: true })}><Plus className="w-3.5 h-3.5 mr-1.5" />Novo serviço</Button></div>
      {servicos.length === 0 ? (
        <Card className="p-6 text-center text-[13px] text-muted-foreground">Nenhum serviço cadastrado.</Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {servicos.map((s) => (
            <Card key={s.id} className={`p-3 flex items-center gap-3 ${s.ativo ? "" : "opacity-50"}`}>
              <span className="w-3 h-3 rounded-full flex-none" style={{ background: s.cor || "#7c3aed" }} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium truncate">{s.nome} {!s.ativo && <span className="text-[10px] text-muted-foreground">(arquivado)</span>}</p>
                <p className="text-[11.5px] text-muted-foreground">{s.duracaoMin} min · {precoBR(s.precoCentavos)} · {(s.profissionalIds || []).length} profissional(is)</p>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDialog({ open: true, edit: s })}><Pencil className="w-3.5 h-3.5" /></Button>
              {s.ativo && <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => arquivar(s)}><Trash2 className="w-3.5 h-3.5" /></Button>}
            </Card>
          ))}
        </div>
      )}
      {dialog.open && <ServicoDialog edit={dialog.edit} profissionais={profissionais} onClose={() => setDialog({ open: false })} onSaved={() => { setDialog({ open: false }); invalidate(); }} />}
    </div>
  );
}

function ServicoDialog({ edit, profissionais, onClose, onSaved }: { edit?: any; profissionais: any[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [nome, setNome] = useState(edit?.nome || "");
  const [duracao, setDuracao] = useState(String(edit?.duracaoMin || 30));
  const [preco, setPreco] = useState(edit?.precoCentavos != null ? String((edit.precoCentavos / 100).toFixed(2)) : "");
  const [cor, setCor] = useState(edit?.cor || CORES[0]);
  const [profIds, setProfIds] = useState<number[]>(edit?.profissionalIds || []);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (!nome.trim()) return toast({ title: "Informe o nome", variant: "destructive" });
    setSalvando(true);
    const body = {
      nome: nome.trim(), duracaoMin: Number(duracao) || 30,
      precoCentavos: preco.trim() ? Math.round(parseFloat(preco.replace(",", ".")) * 100) : null,
      cor, profissionalIds: profIds,
    };
    try {
      if (edit) await apiRequest("PATCH", `/api/agenda/servicos/${edit.id}`, body);
      else await apiRequest("POST", "/api/agenda/servicos", body);
      toast({ title: edit ? "Serviço atualizado" : "Serviço criado" }); onSaved();
    } catch { toast({ title: "Erro ao salvar", variant: "destructive" }); } finally { setSalvando(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{edit ? "Editar serviço" : "Novo serviço"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-[12px]">Nome</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} className="mt-1" placeholder="Ex.: Corte, Consulta, Exame de sangue" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-[12px]">Duração (min)</Label><Input type="number" min={5} step={5} value={duracao} onChange={(e) => setDuracao(e.target.value)} className="mt-1" /></div>
            <div><Label className="text-[12px]">Preço (R$)</Label><Input value={preco} onChange={(e) => setPreco(e.target.value)} className="mt-1" placeholder="opcional" /></div>
          </div>
          <div>
            <Label className="text-[12px]">Cor</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {CORES.map((c) => <button key={c} onClick={() => setCor(c)} className={`w-6 h-6 rounded-full border-2 ${cor === c ? "border-foreground" : "border-transparent"}`} style={{ background: c }} />)}
            </div>
          </div>
          <div>
            <Label className="text-[12px]">Profissionais que fazem</Label>
            {profissionais.length === 0 ? <p className="text-[11.5px] text-muted-foreground mt-1">Cadastre profissionais primeiro.</p> : (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {profissionais.map((p) => {
                  const on = profIds.includes(p.id);
                  return <button key={p.id} onClick={() => setProfIds((x) => on ? x.filter((i) => i !== p.id) : [...x, p.id])}
                    className={`px-2.5 py-1 rounded-md text-[12px] border ${on ? "border-primary bg-primary text-primary-content" : "border-border hover:bg-muted"}`}>{p.nome}</button>;
                })}
              </div>
            )}
          </div>
        </div>
        <DialogFooter><Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button><Button size="sm" onClick={salvar} disabled={salvando}>{salvando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Salvar"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════ PROFISSIONAIS ══════════════════════════════
function ProfissionaisTab({ profissionais, servicos }: { profissionais: any[]; servicos: any[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ open: boolean; edit?: any }>({ open: false });
  const [dispDialog, setDispDialog] = useState<any | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/agenda/profissionais"] });

  async function arquivar(p: any) {
    if (!confirm(`Arquivar "${p.nome}"?`)) return;
    try { await apiRequest("DELETE", `/api/agenda/profissionais/${p.id}`); toast({ title: "Profissional arquivado" }); invalidate(); }
    catch { toast({ title: "Erro ao arquivar", variant: "destructive" }); }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button size="sm" onClick={() => setDialog({ open: true })}><Plus className="w-3.5 h-3.5 mr-1.5" />Novo profissional</Button></div>
      {profissionais.length === 0 ? (
        <Card className="p-6 text-center text-[13px] text-muted-foreground">Nenhum profissional cadastrado.</Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {profissionais.map((p) => {
            const nFaixas = (p.disponibilidade || []).length;
            return (
              <Card key={p.id} className={`p-3 flex items-center gap-3 ${p.ativo ? "" : "opacity-50"}`}>
                <span className="w-8 h-8 rounded-full grid place-items-center text-white text-[13px] font-bold flex-none" style={{ background: p.cor || "#7c3aed" }}>{(p.nome || "?").slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium truncate">{p.nome} {!p.ativo && <span className="text-[10px] text-muted-foreground">(arquivado)</span>}</p>
                  <p className="text-[11.5px] text-muted-foreground">{(p.servicoIds || []).length} serviço(s) · {nFaixas ? `${nFaixas} faixa(s) de horário` : "sem horários"}</p>
                </div>
                <Button variant="ghost" size="sm" className="h-8 text-[11.5px]" onClick={() => setDispDialog(p)}><Clock className="w-3.5 h-3.5 mr-1" />Horários</Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDialog({ open: true, edit: p })}><Pencil className="w-3.5 h-3.5" /></Button>
                {p.ativo && <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => arquivar(p)}><Trash2 className="w-3.5 h-3.5" /></Button>}
              </Card>
            );
          })}
        </div>
      )}
      {dialog.open && <ProfissionalDialog edit={dialog.edit} servicos={servicos} onClose={() => setDialog({ open: false })} onSaved={() => { setDialog({ open: false }); invalidate(); }} />}
      {dispDialog && <DisponibilidadeDialog prof={dispDialog} onClose={() => setDispDialog(null)} onSaved={() => { setDispDialog(null); invalidate(); }} />}
    </div>
  );
}

function ProfissionalDialog({ edit, servicos, onClose, onSaved }: { edit?: any; servicos: any[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [nome, setNome] = useState(edit?.nome || "");
  const [cor, setCor] = useState(edit?.cor || CORES[0]);
  const [svcIds, setSvcIds] = useState<number[]>(edit?.servicoIds || []);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (!nome.trim()) return toast({ title: "Informe o nome", variant: "destructive" });
    setSalvando(true);
    const body = { nome: nome.trim(), cor, servicoIds: svcIds };
    try {
      if (edit) await apiRequest("PATCH", `/api/agenda/profissionais/${edit.id}`, body);
      else await apiRequest("POST", "/api/agenda/profissionais", body);
      toast({ title: edit ? "Profissional atualizado" : "Profissional criado" }); onSaved();
    } catch { toast({ title: "Erro ao salvar", variant: "destructive" }); } finally { setSalvando(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{edit ? "Editar profissional" : "Novo profissional"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-[12px]">Nome</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} className="mt-1" placeholder="Ex.: Dr. João, Barbeiro Pedro, Sala 1" /></div>
          <div>
            <Label className="text-[12px]">Cor</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">{CORES.map((c) => <button key={c} onClick={() => setCor(c)} className={`w-6 h-6 rounded-full border-2 ${cor === c ? "border-foreground" : "border-transparent"}`} style={{ background: c }} />)}</div>
          </div>
          <div>
            <Label className="text-[12px]">Serviços que faz</Label>
            {servicos.length === 0 ? <p className="text-[11.5px] text-muted-foreground mt-1">Cadastre serviços primeiro.</p> : (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {servicos.map((s) => { const on = svcIds.includes(s.id); return <button key={s.id} onClick={() => setSvcIds((x) => on ? x.filter((i) => i !== s.id) : [...x, s.id])} className={`px-2.5 py-1 rounded-md text-[12px] border ${on ? "border-primary bg-primary text-primary-content" : "border-border hover:bg-muted"}`}>{s.nome}</button>; })}
              </div>
            )}
          </div>
        </div>
        <DialogFooter><Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button><Button size="sm" onClick={salvar} disabled={salvando}>{salvando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Salvar"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Editor de disponibilidade semanal (faixas por dia; almoço = 2 faixas) ────
function DisponibilidadeDialog({ prof, onClose, onSaved }: { prof: any; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [faixas, setFaixas] = useState<any[]>((prof.disponibilidade || []).map((d: any) => ({ diaSemana: d.diaSemana, horaInicio: d.horaInicio, horaFim: d.horaFim })));
  const [salvando, setSalvando] = useState(false);

  const add = (dia: number) => setFaixas((f) => [...f, { diaSemana: dia, horaInicio: "09:00", horaFim: "18:00" }]);
  const set = (i: number, k: string, v: string) => setFaixas((f) => f.map((x, idx) => idx === i ? { ...x, [k]: v } : x));
  const rem = (i: number) => setFaixas((f) => f.filter((_, idx) => idx !== i));

  async function salvar() {
    setSalvando(true);
    try {
      await apiRequest("PUT", `/api/agenda/profissionais/${prof.id}/disponibilidade`, { faixas });
      toast({ title: "Disponibilidade salva" }); onSaved();
    } catch { toast({ title: "Erro ao salvar", variant: "destructive" }); } finally { setSalvando(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Horários de {prof.nome}</DialogTitle></DialogHeader>
        <p className="text-[11.5px] text-muted-foreground -mt-1">Faixas de atendimento por dia. Pra intervalo de almoço, crie duas faixas (ex.: 09:00–12:00 e 13:00–18:00).</p>
        <div className="space-y-2.5 mt-1">
          {DIAS.map((dia, idx) => {
            const doDia = faixas.map((f, i) => ({ ...f, _i: i })).filter((f) => f.diaSemana === idx);
            return (
              <div key={idx} className="border border-border rounded-lg p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium">{dia}</span>
                  <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => add(idx)}><Plus className="w-3 h-3 mr-1" />faixa</Button>
                </div>
                {doDia.length === 0 ? <p className="text-[11px] text-muted-foreground mt-1">Fechado</p> : (
                  <div className="space-y-1.5 mt-1.5">
                    {doDia.map((f) => (
                      <div key={f._i} className="flex items-center gap-1.5">
                        <Input type="time" value={f.horaInicio} onChange={(e) => set(f._i, "horaInicio", e.target.value)} className="h-8 w-[110px]" />
                        <span className="text-muted-foreground text-[12px]">até</span>
                        <Input type="time" value={f.horaFim} onChange={(e) => set(f._i, "horaFim", e.target.value)} className="h-8 w-[110px]" />
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => rem(f._i)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <DialogFooter><Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button><Button size="sm" onClick={salvar} disabled={salvando}>{salvando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Salvar horários"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════ FOLGAS ═════════════════════════════════════
function FolgasTab({ profissionais }: { profissionais: any[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [novo, setNovo] = useState(false);
  const { data: bloqueios = [] } = useQuery<any[]>({ queryKey: ["/api/agenda/bloqueios"] });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/agenda/bloqueios"] });
  const nomeProf = (id: number | null) => id ? (profissionais.find((p) => p.id === id)?.nome || "—") : "Todos";

  async function excluir(id: number) {
    if (!confirm("Remover esta folga?")) return;
    try { await apiRequest("DELETE", `/api/agenda/bloqueios/${id}`); toast({ title: "Folga removida" }); invalidate(); }
    catch { toast({ title: "Erro ao remover", variant: "destructive" }); }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button size="sm" onClick={() => setNovo(true)}><Plus className="w-3.5 h-3.5 mr-1.5" />Nova folga</Button></div>
      {bloqueios.length === 0 ? (
        <Card className="p-6 text-center text-[13px] text-muted-foreground">Nenhuma folga/bloqueio cadastrado.</Card>
      ) : (
        <div className="space-y-2">
          {bloqueios.map((b) => (
            <Card key={b.id} className="p-3 flex items-center gap-3">
              <CalendarOff className="w-4 h-4 text-muted-foreground flex-none" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{nomeProf(b.profissionalId)} {b.motivo && <span className="text-muted-foreground font-normal">· {b.motivo}</span>}</p>
                <p className="text-[11.5px] text-muted-foreground">
                  {new Date(b.inicio).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}
                  {" → "}
                  {new Date(b.fim).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}
                </p>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => excluir(b.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
            </Card>
          ))}
        </div>
      )}
      {novo && <FolgaDialog profissionais={profissionais} onClose={() => setNovo(false)} onSaved={() => { setNovo(false); invalidate(); }} />}
    </div>
  );
}

function FolgaDialog({ profissionais, onClose, onSaved }: { profissionais: any[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [profId, setProfId] = useState("todos");
  const [data, setData] = useState(hojeStr());
  const [horaInicio, setHoraInicio] = useState("00:00");
  const [horaFim, setHoraFim] = useState("23:59");
  const [diaTodo, setDiaTodo] = useState(true);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    const hi = diaTodo ? "00:00" : horaInicio, hf = diaTodo ? "23:59" : horaFim;
    const inicio = `${data}T${hi}:00.000Z`;
    const fim = `${data}T${hf}:00.000Z`;
    try {
      await apiRequest("POST", "/api/agenda/bloqueios", {
        profissionalId: profId === "todos" ? null : Number(profId), inicio, fim, motivo: motivo.trim() || null,
      });
      toast({ title: "Folga criada" }); onSaved();
    } catch (e: any) {
      let msg = "Erro ao salvar"; try { const j = String(e?.message || "").match(/\{[\s\S]*\}/); if (j) msg = JSON.parse(j[0]).error || msg; } catch {}
      toast({ title: msg, variant: "destructive" });
    } finally { setSalvando(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Nova folga / bloqueio</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-[12px]">Profissional</Label>
            <Select value={profId} onValueChange={setProfId}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="todos">Todos</SelectItem>{profissionais.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-[12px]">Data</Label><Input type="date" value={data} onChange={(e) => setData(e.target.value)} className="mt-1" /></div>
          <div className="flex items-center justify-between">
            <Label className="text-[12px]">Dia inteiro</Label>
            <Switch checked={diaTodo} onCheckedChange={setDiaTodo} />
          </div>
          {!diaTodo && (
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-[12px]">De</Label><Input type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} className="mt-1" /></div>
              <div><Label className="text-[12px]">Até</Label><Input type="time" value={horaFim} onChange={(e) => setHoraFim(e.target.value)} className="mt-1" /></div>
            </div>
          )}
          <div><Label className="text-[12px]">Motivo (opcional)</Label><Input value={motivo} onChange={(e) => setMotivo(e.target.value)} className="mt-1" placeholder="Feriado, férias…" /></div>
        </div>
        <DialogFooter><Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button><Button size="sm" onClick={salvar} disabled={salvando}>{salvando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Salvar"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
