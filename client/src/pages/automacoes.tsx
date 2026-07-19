import { useState, useRef, useEffect } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Zap, Pause, Play, Plus, BookOpen, Trash2, PenLine, X, Copy, TestTube, Check,
  AlertCircle, Loader2, FileText, LayoutTemplate, Plug, Download,
  FileUp, Share2, Upload, Flag,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Instagram } from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import {
  FlowNode, Automation, NODE_TYPES, TRIGGER_OPTIONS, STATUS_CONF, TEMPLATES,
  INITIAL_AUTOMATIONS, genId, buildTestLog, mapApiToLocal,
} from "@/components/automacoes/types";
import { AutomationEditorTabs } from "@/components/automacoes/FlowCanvas";
import InstaProspect from "@/pages/InstaProspect";
import { PageHeader, PageTabs } from "@/components/page/PageShell";

export default function Automacoes() {
  const { toast } = useToast();
  const [list, setList] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selIdx, setSelIdx] = useState<number | null>(null);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [selNode, setSelNode] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [modal, setModal] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newTrig, setNewTrig] = useState("new_message");
  const [renamingIdx, setRenamingIdx] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [testLog, setTestLog] = useState<ReturnType<typeof buildTestLog> | null>(null);
  const undoStackRef = useRef<FlowNode[][]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const MAX_UNDO = 50;
  const [listImportOpen, setListImportOpen] = useState(false);
  const [listImportJson, setListImportJson] = useState("");
  const [listImportError, setListImportError] = useState("");
  const listImportFileRef = useRef<HTMLInputElement>(null);

  async function importAgentToNewAutomation(jsonStr: string) {
    try {
      const data = JSON.parse(jsonStr);
      if (!data._chatbanana_agent || !Array.isArray(data.nodes)) {
        setListImportError("Arquivo inválido. Use um JSON exportado pelo Norte Gestão.");
        return;
      }
      if (data.nodes.length === 0) {
        setListImportError("O agente importado não possui nós.");
        return;
      }
      const nome = data.nome ? `${data.nome} (importado)` : "Agente Importado";
      const trigType = data.triggerType || "new_message";
      try {
        const res = await apiRequest("POST", "/api/automacoes", { nome, triggerType: trigType, nodes: data.nodes });
        if (!res.ok) { setListImportError("Erro ao criar automação no servidor."); return; }
        const result = await res.json();
        if (result?.data) {
          const newAuto = mapApiToLocal(result.data);
          setList(prev => [newAuto, ...prev]);
          setListImportOpen(false);
          setListImportJson("");
          setListImportError("");
          toast({ title: `Agente "${nome}" importado com sucesso!` });
        }
      } catch {
        setListImportError("Erro de conexão ao importar.");
      }
    } catch (e: any) {
      setListImportError("JSON inválido: " + e.message);
    }
  }

  function pushUndo() {
    undoStackRef.current.push(JSON.parse(JSON.stringify(nodes)));
    if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
    setUndoCount(undoStackRef.current.length);
  }

  function undo() {
    const snapshot = undoStackRef.current.pop();
    if (!snapshot) return;
    setNodes(snapshot);
    setUndoCount(undoStackRef.current.length);
    setIsDirty(true);
    setSelNode(null);
  }

  const queryClient = useQueryClient();

  const { data: integConfigData } = useQuery<{ ok: boolean; data: Record<string, { enabled: boolean; config: any }> }>({ queryKey: ["/api/integrations/config"] });
  const instagramEnabled = integConfigData?.data?.instagram?.enabled !== false;

  const [conexoesMap, setConexoesMap] = useState<Record<string, { nome: string; status: string; numero?: string }>>({});

  useEffect(() => {
    apiRequest("GET", "/api/automacoes")
      .then((r) => r.json())
      .then((res) => {
        if (res.ok && Array.isArray(res.data)) {
          setList(res.data.map(mapApiToLocal));
        } else {
          toast({ title: "Erro ao carregar automações", variant: "destructive" });
          setList([]);
        }
      })
      .catch(() => {
        toast({ title: "Erro de conexão - usando dados locais", variant: "destructive" });
        setList(INITIAL_AUTOMATIONS);
      })
      .finally(() => setLoading(false));

    apiRequest("GET", "/api/conexoes")
      .then((r) => r.json())
      .then((res) => {
        if (res.ok && Array.isArray(res.data)) {
          const map: Record<string, { nome: string; status: string; numero?: string }> = {};
          for (const c of res.data) {
            if (c.automacaoId) {
              map[c.automacaoId] = { nome: c.nome, status: c.status, numero: c.numero };
            }
          }
          apiRequest("GET", "/api/whatsapp-official/connection")
            .then((r2) => r2.json())
            .then((metaRes) => {
              if (metaRes.connected && metaRes.data?.automacaoId) {
                map[metaRes.data.automacaoId] = {
                  nome: metaRes.data.businessName || "WA Oficial",
                  status: "connected",
                  numero: metaRes.data.displayPhoneNumber,
                };
              }
              setConexoesMap({ ...map });
            })
            .catch(() => setConexoesMap({ ...map }));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: any) => {
      const newNodes = e.detail?.nodes;
      if (newNodes?.length) {
        setNodes(newNodes);
        setIsDirty(true);
        setSelNode(null);
        setTimeout(() => {
          const triggerNode = newNodes.find((n: any) => n.type === "trigger") || newNodes[0];
          if (triggerNode) {
            const el = document.getElementById("fn-" + triggerNode.id);
            if (el) {
              el.scrollIntoView({ behavior: "instant", block: "start", inline: "center" });
              return;
            }
          }
          const canvas = document.getElementById('flow-canvas');
          if (canvas) {
            canvas.scrollTop = 0;
            canvas.scrollLeft = 0;
          }
        }, 200);
      }
    };
    window.addEventListener("banana-creator-apply", handler);
    return () => window.removeEventListener("banana-creator-apply", handler);
  }, []);

  function openAuto(i: number) {
    const a = list[i];
    setSelIdx(i);
    const loadedNodes = a.nodes?.length ? JSON.parse(JSON.stringify(a.nodes)) : defaultNodes(a);
    setNodes(loadedNodes);
    setSelNode(null);
    setIsDirty(false);
    setTestLog(null);
    window.dispatchEvent(new CustomEvent("flowcrm-sidebar-control", { detail: { collapse: true } }));
    setTimeout(() => {
      const trigger = loadedNodes.find((n: FlowNode) => n.type === "trigger") || loadedNodes[0];
      if (trigger) {
        const el = document.getElementById("fn-" + trigger.id);
        if (el) { el.scrollIntoView({ behavior: "instant", block: "start", inline: "center" }); return; }
      }
      const canvas = document.getElementById('flow-canvas');
      if (canvas) { canvas.scrollTop = 0; canvas.scrollLeft = 0; }
    }, 200);
  }

  function defaultNodes(a: Automation): FlowNode[] {
    return [
      { id: "n1", type: "trigger", label: a.trigger || "Gatilho", config: { triggerType: "new_message" }, x: 180, y: 30, next: ["n2"] },
      { id: "n2", type: "send_message", label: "Enviar mensagem", config: { content: "" }, x: 180, y: 170, next: ["n3"] },
      { id: "n3", type: "end", label: "Fim do fluxo", config: {}, x: 180, y: 310, next: [] },
    ];
  }

  function addNode(type: string, x = 220, y = 200) {
    pushUndo();
    const id = genId();
    const conf = NODE_TYPES[type] || NODE_TYPES.end;
    const defaultConfig: Record<string, any> =
      type === "ai_response" ? { replyDelay: 10, replyDelayUnit: "seconds" }
      : type === "agente" ? { model: "gpt-4o-mini", temperature: 0.6, replyDelay: 8, replyDelayUnit: "seconds", nome: "", papel: "", objetivo: "", escopo: "", limites: "", tomVoz: "" }
      : {};
    setNodes((prev) => [...prev, { id, type, label: conf.label, config: defaultConfig, x, y, next: [] }]);
    setSelNode(id);
    setIsDirty(true);
  }

  function updateNodePos(id: string, x: number, y: number) {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));
  }

  function updateNodePosBatch(updates: { id: string; x: number; y: number }[]) {
    setNodes((prev) => {
      const map = new Map(updates.map(u => [u.id, u]));
      return prev.map(n => {
        const u = map.get(n.id);
        return u ? { ...n, x: u.x, y: u.y } : n;
      });
    });
  }

  function updateNodeCfg(id: string, field: string, value: any) {
    pushUndo();
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, config: { ...n.config, [field]: value } } : n)));
    setIsDirty(true);
  }

  function updateNodeLabel(id: string, label: string) {
    pushUndo();
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, label } : n)));
    setIsDirty(true);
  }

  function deleteNode(id: string) {
    pushUndo();
    setNodes((prev) =>
      prev
        .filter((n) => n.id !== id)
        .map((n) => {
          const cleaned: any = {
            ...n,
            next: (n.next || []).filter((x) => x !== id),
            nextTrue: n.nextTrue === id ? undefined : n.nextTrue,
            nextFalse: n.nextFalse === id ? undefined : n.nextFalse,
            nextTextInput: n.nextTextInput === id ? undefined : n.nextTextInput,
          };
          if (n.nextOptions) {
            const filtered: Record<string, string> = {};
            for (const [k, v] of Object.entries(n.nextOptions)) {
              if (v !== id) filtered[k] = v;
            }
            cleaned.nextOptions = Object.keys(filtered).length > 0 ? filtered : undefined;
          }
          return cleaned;
        })
    );
    if (selNode === id) setSelNode(null);
    setIsDirty(true);
  }

  function addEdge(fromId: string, toId: string, branch: string | null) {
    pushUndo();
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== fromId) return n;
        if (branch === "true") return { ...n, nextTrue: toId };
        if (branch === "false") return { ...n, nextFalse: toId };
        if (branch && branch.startsWith("opt_")) return { ...n, nextOptions: { ...(n.nextOptions || {}), [branch]: toId } };
        if (branch === "text_input") return { ...n, nextTextInput: toId };
        if (branch && n.type === "split_ia") return { ...n, nextOptions: { ...(n.nextOptions || {}), [branch]: toId } };
        return (n.next || []).includes(toId) ? n : { ...n, next: [...(n.next || []), toId] };
      })
    );
    setIsDirty(true);
    toast({ title: "Nós conectados" });
  }

  function removeEdge(fromId: string, toId: string, branch: string | null) {
    pushUndo();
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== fromId) return n;
        if (branch === "true" && n.nextTrue === toId) return { ...n, nextTrue: undefined };
        if (branch === "false" && n.nextFalse === toId) return { ...n, nextFalse: undefined };
        if (branch === "text_input" && n.nextTextInput === toId) return { ...n, nextTextInput: undefined };
        if (branch && (branch.startsWith("opt_") || n.type === "split_ia") && n.nextOptions?.[branch] === toId) {
          const updated = { ...(n.nextOptions || {}) };
          delete updated[branch];
          return { ...n, nextOptions: Object.keys(updated).length > 0 ? updated : undefined };
        }
        if (!branch) return { ...n, next: (n.next || []).filter((x) => x !== toId) };
        return n;
      })
    );
    setIsDirty(true);
    toast({ title: "Conexão removida" });
  }

  function quickAddFromBranch(fromId: string, branch: string, nodeType: string) {
    pushUndo();
    const fromNode = nodes.find((n) => n.id === fromId);
    if (!fromNode) return;
    const optIdx = (fromNode.config?.options || []).findIndex((o: any) => o.id === branch);
    const offsetX = optIdx >= 0 ? (optIdx - Math.floor((fromNode.config?.options || []).length / 2)) * 200 : 0;
    const newId = genId();
    const conf = NODE_TYPES[nodeType] || NODE_TYPES.end;
    const newNode: FlowNode = {
      id: newId, type: nodeType, label: conf.label, config: {},
      x: (fromNode.x || 0) + offsetX, y: (fromNode.y || 0) + 180, next: [],
    };
    setNodes((prev) => {
      const withNew = [...prev, newNode];
      return withNew.map((n) => {
        if (n.id !== fromId) return n;
        if (branch === "text_input") return { ...n, nextTextInput: newId };
        if (branch.startsWith("opt_") || n.type === "split_ia") return { ...n, nextOptions: { ...(n.nextOptions || {}), [branch]: newId } };
        return n;
      });
    });
    setSelNode(newId);
    setIsDirty(true);
    toast({ title: "Nó criado e conectado" });
  }

  function insertNodeOnEdge(fromId: string, toId: string, branch: string | null, newType: string) {
    pushUndo();
    const newId = "n_" + Date.now();
    const fromNode = nodes.find((n) => n.id === fromId);
    const toNode = nodes.find((n) => n.id === toId);
    if (!fromNode || !toNode) return;
    const midX = ((fromNode.x || 0) + (toNode.x || 0)) / 2;
    const midY = ((fromNode.y || 0) + (toNode.y || 0)) / 2;
    const newNode: FlowNode = {
      id: newId,
      type: newType,
      label: (NODE_TYPES[newType]?.label || newType),
      config: {},
      x: midX,
      y: midY,
      next: [toId],
    };
    setNodes((prev) => {
      const updated = prev.map((n) => {
        if (n.id !== fromId) return n;
        if (branch === "true" && n.nextTrue === toId) return { ...n, nextTrue: newId };
        if (branch === "false" && n.nextFalse === toId) return { ...n, nextFalse: newId };
        if (branch === "text_input" && n.nextTextInput === toId) return { ...n, nextTextInput: newId };
        if (branch && (branch.startsWith("opt_") || n.type === "split_ia") && n.nextOptions?.[branch] === toId) {
          return { ...n, nextOptions: { ...(n.nextOptions || {}), [branch]: newId } };
        }
        if (!branch) return { ...n, next: (n.next || []).map((x) => x === toId ? newId : x) };
        return n;
      });
      return [...updated, newNode];
    });
    setIsDirty(true);
    setSelNode(newId);
    toast({ title: `Nó "${NODE_TYPES[newType]?.label || newType}" inserido` });
  }

  async function saveFlow() {
    if (selIdx === null) return;
    const a = list[selIdx];

    for (const n of nodes) {
      if (n.type === "lista_opcoes") {
        const opts = (n.config?.options || []) as { id: string; label: string }[];
        if (opts.length === 0) {
          toast({ title: `Nó "${n.label}": adicione pelo menos 1 opção`, variant: "destructive" });
          return;
        }
        const emptyLabel = opts.find(o => !o.label?.trim());
        if (emptyLabel) {
          toast({ title: `Nó "${n.label}": preencha o título de todas as opções`, variant: "destructive" });
          return;
        }
        if (!n.config?.button_label?.trim()) {
          toast({ title: `Nó "${n.label}": preencha o texto do botão`, variant: "destructive" });
          return;
        }
      }
    }

    setList((prev) => prev.map((x, i) => (i === selIdx ? { ...x, nodes, passos: nodes.length } : x)));
    setIsDirty(false);
    if (a.id && !a._local) {
      try {
        const res = await apiRequest("PUT", `/api/automacoes/${a.id}`, { nodes });
        if (res.status === 401) { window.location.href = "/login"; return; }
        if (!res.ok) toast({ title: "Erro ao salvar no servidor", variant: "destructive" });
      } catch {
        toast({ title: "Erro de conexão ao salvar", variant: "destructive" });
      }
    }
    toast({ title: "Automação salva com sucesso" });
  }

  async function toggleStatus(i: number) {
    const a = list[i];
    const nextStatus = a.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setList((prev) => prev.map((x, idx) => (idx === i ? { ...x, status: nextStatus as Automation["status"] } : x)));
    if (a.id && !a._local) {
      try {
        const res = await apiRequest("PATCH", `/api/automacoes/${a.id}/toggle`);
        const json = await res.json();
        if (json.ok) {
          setList((prev) => prev.map((x, idx) => (idx === i ? { ...x, status: json.data.status } : x)));
        }
      } catch {}
    }
    toast({ title: nextStatus === "ACTIVE" ? `"${a.nome}" ativada` : `"${a.nome}" pausada` });
  }

  async function duplicateAuto(i: number) {
    const a = list[i];
    if (a.id && !a._local) {
      try {
        const res = await apiRequest("POST", `/api/automacoes/${a.id}/duplicate`);
        const json = await res.json();
        if (json.ok) {
          setList((prev) => [...prev, mapApiToLocal(json.data)]);
          setSubTab("rascunhos");
          setSelIdx(null);
          setNodes([]);
          setSelNode(null);
          toast({ title: `"${a.nome}" duplicada para Rascunhos` });
          return;
        }
      } catch (err) {
        console.error("Erro ao duplicar:", err);
      }
    }
    const copy: Automation = { ...JSON.parse(JSON.stringify(a)), nome: `${a.nome} (cópia)`, status: "DRAFT", execucoes: 0, _local: true, id: undefined };
    setList((prev) => [...prev, copy]);
    setSubTab("rascunhos");
    setSelIdx(null);
    setNodes([]);
    setSelNode(null);
    toast({ title: `"${a.nome}" duplicada para Rascunhos` });
  }

  async function deleteAuto(i: number) {
    if (!window.confirm(`Excluir "${list[i].nome}"?`)) return;
    const a = list[i];
    if (a.id && !a._local) {
      try {
        const res = await apiRequest("DELETE", `/api/automacoes/${a.id}`);
        const json = await res.json();
        if (!json.ok) {
          toast({ title: "Erro ao excluir", variant: "destructive" });
          return;
        }
      } catch {
        toast({ title: "Erro ao excluir", variant: "destructive" });
        return;
      }
    }
    setDeletingIdx(i);
    setTimeout(() => {
      setList((prev) => prev.filter((_, idx) => idx !== i));
      if (selIdx === i) {
        setSelIdx(null);
        setNodes([]);
        setSelNode(null);
      } else if (selIdx !== null && i < selIdx) {
        setSelIdx(selIdx - 1);
      }
      setDeletingIdx(null);
    }, 400);
  }

  function startRename(i: number) {
    setRenamingIdx(i);
    setRenameValue(list[i].nome);
    setModal("rename");
  }

  async function confirmRename(i: number) {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === list[i].nome) {
      setRenamingIdx(null);
      return;
    }
    setList((prev) => prev.map((x, idx) => (idx === i ? { ...x, nome: trimmed } : x)));
    setRenamingIdx(null);
    const a = list[i];
    if (a.id && !a._local) {
      try {
        await apiRequest("PUT", `/api/automacoes/${a.id}`, { nome: trimmed });
      } catch {
        toast({ title: "Erro ao renomear no servidor", variant: "destructive" });
      }
    }
    toast({ title: "Nome atualizado" });
  }

  async function testRun() {
    setModal("test");
    setTestLog(null);
    const a = selIdx !== null ? list[selIdx] : null;
    if (a?.id && !a._local) {
      try {
        const res = await apiRequest("POST", `/api/automacoes/${a.id}/execute`, {
          payload: { nome: "Joao Teste", empresa: "Empresa Teste", telefone: "11999990000" },
        });
        const json = await res.json();
        if (json.ok) {
          setTestLog(json.data);
          setList((prev) => prev.map((x, idx) => (idx === selIdx ? { ...x, execucoes: (x.execucoes || 0) + 1 } : x)));
          return;
        }
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 1400));
    setTestLog(buildTestLog(nodes));
  }

  async function createNew() {
    if (!newName.trim()) return;
    const trigLabel = TRIGGER_OPTIONS.find((o) => o.value === newTrig)?.label || newTrig;
    const newNodes: FlowNode[] = [
      { id: "n1", type: "trigger", label: trigLabel, config: { triggerType: newTrig }, x: 180, y: 30, next: ["n2"] },
      { id: "n2", type: "send_message", label: "Enviar mensagem", config: { content: "" }, x: 180, y: 170, next: ["n3"] },
      { id: "n3", type: "end", label: "Fim do fluxo", config: {}, x: 180, y: 310, next: [] },
    ];
    let novo: Automation = {
      nome: newName.trim(),
      status: "DRAFT",
      trigger: trigLabel,
      triggerType: newTrig,
      execucoes: 0,
      passos: 3,
      _local: true,
      nodes: newNodes,
    };
    try {
      const res = await apiRequest("POST", "/api/automacoes", {
        nome: novo.nome,
        trigger_type: newTrig,
        nodes: newNodes,
        status: "DRAFT",
      });
      const json = await res.json();
      if (json.ok) {
        novo = mapApiToLocal(json.data);
        novo.nodes = json.data.nodes || newNodes;
      }
    } catch {}
    const newList = [...list, novo];
    setList(newList);
    setModal(null);
    setNewName("");
    setSelIdx(newList.length - 1);
    setNodes(JSON.parse(JSON.stringify(novo.nodes)));
    setSelNode(null);
    setIsDirty(false);
    setTestLog(null);
    toast({ title: "Automação criada - configure os nós no editor" });
  }

  async function useTemplate(tpl: typeof TEMPLATES[0]) {
    const tplNodes = JSON.parse(JSON.stringify(tpl.nodes)) as FlowNode[];
    const trigType = tplNodes[0]?.config?.triggerType || "new_message";
    let novo: Automation = {
      nome: tpl.name,
      status: "DRAFT",
      trigger: tpl.trigger,
      triggerType: trigType,
      execucoes: 0,
      passos: tpl.nodes.length,
      _local: true,
      nodes: tplNodes,
    };
    try {
      const res = await apiRequest("POST", "/api/automacoes", {
        nome: tpl.name,
        trigger_type: trigType,
        nodes: tplNodes,
        status: "DRAFT",
      });
      const json = await res.json();
      if (json.ok) {
        novo = mapApiToLocal(json.data);
        novo.nodes = json.data.nodes || tplNodes;
      }
    } catch {}
    const newList = [...list, novo];
    setList(newList);
    setModal(null);
    setSelIdx(newList.length - 1);
    setNodes(JSON.parse(JSON.stringify(novo.nodes)));
    setSelNode(null);
    setIsDirty(false);
    setTestLog(null);
    toast({ title: `Template "${tpl.name}" carregado` });
  }

  const [deletingIdx, setDeletingIdx] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"templates" | "insta-prospect">("templates");
  const [subTab, setSubTab] = useState<"ativos" | "pausados" | "rascunhos">("ativos");

  const templates = list.filter((a) => a.status === "ACTIVE" || a.status === "PAUSED");
  const drafts = list.filter((a) => a.status === "DRAFT");
  const activeTemplates = list.filter((a) => a.status === "ACTIVE");
  const pausedTemplates = list.filter((a) => a.status === "PAUSED");
  const activeCount = list.filter((a) => a.status === "ACTIVE").length;
  const pausedCount = list.filter((a) => a.status === "PAUSED").length;
  const totalExec = list.reduce((s, a) => s + (a.execucoes || 0), 0);
  const curAuto = selIdx !== null ? list[selIdx] : null;

  function renderAutoCard(a: Automation) {
    const realIdx = list.indexOf(a);
    const sc = STATUS_CONF[a.status] || STATUS_CONF.DRAFT;
    const BtnIcon = sc.btnIcon;
    const nodeCount = (Array.isArray(a.nodes) ? a.nodes.length : a.passos) || 0;
    const isDraft = a.status === "DRAFT";
    const isDeleting = deletingIdx === realIdx;
    // Pill semântica de status — bg sutil + dot + label num único chip.
    // ACTIVE: banana glow pulsante. PAUSED: amber. DRAFT: neutral muted.
    // Bruno 2026-05-15: pills usam tokens dark-aware. Light vê banana-50 +
    // banana-800 (escuro). Dark vê glow âmbar + #FFD24A claro. PAUSED em
    // dark precisa de fg #FBBF24 pra ser legível (B45309 some no fundo).
    const statusPillStyle = isDraft
      ? { background: "rgba(156,163,175,0.12)", color: "var(--muted-foreground)", borderColor: "rgba(156,163,175,0.25)" }
      : a.status === "ACTIVE"
        ? { background: "var(--chip-active-bg)", color: "var(--chip-active-fg-num)", borderColor: "var(--chip-active-border)" }
        : { background: "var(--chip-paused-bg)", color: "var(--chip-paused-fg)", borderColor: "var(--chip-paused-border)" };

    return (
      <Card
        key={a.id || realIdx}
        className={`overflow-hidden cursor-pointer border-border/70 card-banana-hover group ${isDeleting ? "scale-75 opacity-0 -translate-y-4 pointer-events-none" : "scale-100 opacity-100 translate-y-0"}`}
        style={isDeleting ? { transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)" } : undefined}
        onClick={() => openAuto(realIdx)}
        data-testid={`button-auto-item-${realIdx}`}
      >
        <div className="p-3.5">
          <div className="flex items-start justify-between mb-2 gap-2">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 border"
                style={isDraft
                  ? { background: "hsl(var(--secondary))", borderColor: "hsl(var(--border))" }
                  : { background: "var(--banana-100)", borderColor: "var(--banana-300)" }
                }
              >
                {isDraft
                  ? <FileText className="w-4 h-4 text-muted-foreground" />
                  : <Zap className="w-4 h-4" style={{ color: "var(--banana-700)" }} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold tracking-tight truncate" data-testid={`text-auto-name-${realIdx}`}>{a.nome}</div>
                <div className="text-[10.5px] text-muted-foreground truncate mt-0.5">{a.trigger}</div>
              </div>
            </div>
            <span
              className="inline-flex items-center gap-1 px-2 py-[3px] rounded-full text-[9.5px] font-bold border flex-shrink-0"
              style={statusPillStyle}
            >
              {a.status === "ACTIVE" ? (
                <span className="automation-active-indicator automation-active-indicator-sm" style={{ width: 8, height: 8 }}>
                  <span className="dot-core" />
                  <span className="dot-ring" />
                  <span className="dot-ring-2" />
                </span>
              ) : (
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
              )}
              {isDraft ? "Rascunho" : sc.label}
            </span>
          </div>
          <div className="flex gap-1.5 flex-wrap mb-2.5">
            <Badge variant="outline" className="text-[9.5px] px-2 py-0 h-[18px] font-medium bg-secondary/50">{nodeCount} {nodeCount === 1 ? "nó" : "nós"}</Badge>
            {!isDraft && <Badge variant="outline" className="text-[9.5px] px-2 py-0 h-[18px] font-medium bg-secondary/50 tabular-nums">{(a.execucoes || 0).toLocaleString("pt-BR")} exec</Badge>}
            {a.id && conexoesMap[a.id] && a.status === "ACTIVE" && (
              <Badge
                className="text-[8px] px-1.5 py-0 h-4 gap-0.5 border-0 font-bold"
                style={{
                  background: conexoesMap[a.id].status === "connected" ? "hsl(var(--primary))" : "rgba(251, 191, 36, 0.15)",
                  color: conexoesMap[a.id].status === "connected" ? "hsl(var(--primary-foreground))" : "#fbbf24",
                  textShadow: "none",
                  boxShadow: conexoesMap[a.id].status === "connected" ? "0 0 6px hsl(var(--primary) / 0.45)" : "none",
                }}
                data-testid={`badge-conexao-${realIdx}`}
              >
                <Plug className="w-2.5 h-2.5" />
                {conexoesMap[a.id].nome}
              </Badge>
            )}
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-border/40">
            <div className="flex gap-0.5">
              <Button variant="ghost" size="icon" className="h-7 w-7 group/action rounded-md transition-colors hover:bg-primary/10 hover:text-primary" onClick={(e) => { e.stopPropagation(); startRename(realIdx); }} title="Renomear" data-testid={`button-auto-rename-${realIdx}`}>
                <PenLine className="w-3 h-3 transition-transform duration-200 group-hover/action:scale-110 group-hover/action:rotate-[-12deg]" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 group/action rounded-md transition-colors hover:bg-primary/10 hover:text-primary" onClick={(e) => { e.stopPropagation(); duplicateAuto(realIdx); }} title="Duplicar" data-testid={`button-auto-dup-${realIdx}`}>
                <Copy className="w-3 h-3 transition-transform duration-200 group-hover/action:scale-110 group-hover/action:translate-x-[1px] group-hover/action:translate-y-[-1px]" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 group/action rounded-md transition-colors hover:bg-primary/10 hover:text-primary" onClick={(e) => {
                e.stopPropagation();
                const a = list[realIdx];
                const exportData = {
                  _chatbanana_agent: true, version: 1, exportedAt: new Date().toISOString(),
                  nome: a.nome, triggerType: a.triggerType || a.trigger,
                  nodes: (a.nodes || []).map((n: any) => ({ id: n.id, type: n.type, label: n.label, config: n.config, x: n.x, y: n.y, next: n.next, nextTrue: n.nextTrue, nextFalse: n.nextFalse, nextOptions: n.nextOptions, nextTextInput: n.nextTextInput })),
                };
                const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const el = document.createElement("a");
                el.href = url; el.download = `agente-${a.nome.replace(/\s+/g, "-").toLowerCase()}.json`; el.click();
                URL.revokeObjectURL(url);
                toast({ title: "Agente exportado!" });
              }} title="Exportar como JSON" data-testid={`button-auto-export-${realIdx}`}>
                <Download className="w-3 h-3 transition-transform duration-200 group-hover/action:scale-110 group-hover/action:translate-y-[1px]" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 group/action rounded-md transition-colors hover:bg-destructive/10 hover:text-destructive" onClick={(e) => { e.stopPropagation(); deleteAuto(realIdx); }} title="Excluir" data-testid={`button-auto-del-${realIdx}`}>
                <Trash2 className="w-3 h-3 transition-transform duration-200 group-hover/action:scale-110 group-hover/action:rotate-[8deg]" />
              </Button>
            </div>
            {/* Botão primário do estado — Ativar usa gradient-accent (banana
                sólida + ink-on-banana), Pausar usa outline amber pra
                diferenciar sem competir com o CTA. */}
            {isDraft || a.status === "PAUSED" ? (
              <Button
                size="sm"
                className="h-7 px-3 rounded-md text-[10.5px] font-bold gradient-accent"
                onClick={(e) => { e.stopPropagation(); toggleStatus(realIdx); }}
                data-testid={`button-auto-toggle-${realIdx}`}
              >
                <Play className="w-3 h-3 mr-1" /> Ativar
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-3 rounded-md text-[10.5px] font-bold transition-colors"
                style={{ borderColor: "var(--chip-paused-border)", color: "var(--chip-paused-fg)", background: "var(--chip-paused-bg)" }}
                onClick={(e) => { e.stopPropagation(); toggleStatus(realIdx); }}
                data-testid={`button-auto-toggle-${realIdx}`}
              >
                <BtnIcon className="w-3 h-3 mr-1" /> {sc.btn}
              </Button>
            )}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden relative bg-background page-banana-wash" data-testid="page-automacoes">
      {/* Bruno 2026-05-15: header padrão "Banana Trail" — h1 22px + subtítulo
          muted + chips de métricas. Pattern unificado pela Central de
          Atendimentos. */}
      <div className="px-6 pt-5 pb-4 bg-background flex-shrink-0">
        {/* Bruno 2026-05-15: chips dark-aware via tokens --chip-active-* /
            --chip-paused-* / --chip-exec-*. Em light usa banana-50 sólido,
            em dark vira glow ouro queimado pra não competir com fundo
            escuro nem virar branco-creme destoante. */}
        <PageHeader
          title="Motor de Automações"
          subtitle="Crie fluxos inteligentes sem escrever código"
          actions={
            <div className="flex items-center gap-3 text-[11.5px] text-muted-foreground">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors"
                style={{ background: "var(--chip-active-bg)", borderColor: "var(--chip-active-border)" }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--chip-active-dot)" }} />
                <strong className="tabular-nums text-base-content">{activeCount}</strong>
                <span style={{ color: "var(--chip-active-fg)" }}>Ativas</span>
              </span>
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors"
                style={{ background: "var(--chip-paused-bg)", borderColor: "var(--chip-paused-border)" }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--chip-paused-dot)" }} />
                <strong className="tabular-nums text-base-content">{pausedCount}</strong>
                <span style={{ color: "var(--chip-paused-fg)" }}>Pausadas</span>
              </span>
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors"
                style={{ background: "var(--chip-exec-bg)", borderColor: "var(--chip-exec-border)" }}
              >
                <Zap className="w-3 h-3" style={{ color: "var(--chip-exec-fg)" }} />
                <strong className="tabular-nums text-base-content">{totalExec.toLocaleString("pt-BR")}</strong>
                <span>Execuções</span>
              </span>
            </div>
          }
        />
      </div>

      {/* Tabs de canal (WhatsApp / Instagram) — padrão Banana Trail
          underline marrom + gradient banana na ativa. */}
      <div className="flex flex-col flex-shrink-0 bg-background px-6">
        <PageTabs
          active={activeTab}
          onChange={(k) => setActiveTab(k as any)}
          tabs={[
            { key: "templates", label: "WhatsApp", icon: <SiWhatsapp className="w-4 h-4" style={{ color: "#25d366" }} />, count: list.length },
            ...(instagramEnabled ? [{ key: "insta-prospect", label: "Instagram", icon: <Instagram className="w-4 h-4" style={{ color: "#E1306C" }} /> }] : []),
          ]}
        />
        {activeTab === "templates" && (
          <div className="flex items-center gap-2 py-3">
            <div className="flex gap-1 flex-1">
              {([
                { key: "ativos" as const, label: "Ativos", count: activeTemplates.length, dotColor: "var(--chip-active-dot)" },
                { key: "pausados" as const, label: "Pausados", count: pausedTemplates.length, dotColor: "var(--chip-paused-dot)" },
                { key: "rascunhos" as const, label: "Rascunhos", count: drafts.length, dotColor: "#9CA3AF" },
              ]).map((tab) => {
                const isActive = subTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    className={`seg-tab ${isActive ? "seg-tab-active" : ""}`}
                    onClick={() => { setSubTab(tab.key); setSelIdx(null); setNodes([]); setSelNode(null); }}
                    data-testid={`subtab-${tab.key}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: isActive ? "currentColor" : tab.dotColor }} />
                    {tab.label}
                    <span
                      className={`text-[9.5px] px-1.5 py-[1px] rounded-full min-w-[18px] text-center tabular-nums font-bold ${
                        isActive ? "bg-primary-content/20 text-primary-content" : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
            <Button variant="outline" size="sm" className="h-8 px-3 text-[11.5px] font-semibold gap-1.5" onClick={() => setListImportOpen(true)} data-testid="button-auto-import">
              <FileUp className="w-3.5 h-3.5" /> Importar
            </Button>
            <Button size="sm" className="gradient-accent gradient-accent-glow h-8 px-3 text-[11.5px] font-bold gap-1.5" onClick={() => setModal("new")} data-testid="button-auto-new">
              <Plus className="w-3.5 h-3.5" /> Nova Automação
            </Button>
          </div>
        )}
      </div>

      {activeTab === "insta-prospect" && instagramEnabled && (
        <div className="flex-1 overflow-y-auto anim-tab-fade" key="auto-insta">
          <InstaProspect />
        </div>
      )}

      {activeTab === "templates" && !curAuto && (
        <div className="flex-1 overflow-y-auto p-5 anim-tab-fade" key="auto-templates">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-primary dark:text-white" />
              <span className="text-[12px]">Carregando automações...</span>
            </div>
          )}

          {!loading && subTab === "ativos" && (
            <>
              {activeTemplates.length === 0 ? (
                <EmptyState icon="⚡" title="Nenhuma automação criada" description="Automatize mensagens, qualificação de leads e muito mais." actionLabel="Criar Automação" onAction={() => { setSubTab("rascunhos"); }} />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {activeTemplates.map((a) => renderAutoCard(a))}
                </div>
              )}
            </>
          )}

          {!loading && subTab === "pausados" && (
            <>
              {pausedTemplates.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground" data-testid="paused-list-empty">
                  <Pause className="w-14 h-14 opacity-20" />
                  <span className="text-[14px] font-medium">Nenhuma automação pausada</span>
                  <span className="text-[11px] max-w-[300px] text-center leading-relaxed">Automações pausadas aparecerão aqui</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {pausedTemplates.map((a) => renderAutoCard(a))}
                </div>
              )}
            </>
          )}

          {!loading && subTab === "rascunhos" && (
            <>
              {drafts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground" data-testid="drafts-list-empty">
                  <FileText className="w-14 h-14 opacity-20" />
                  <span className="text-[14px] font-medium">Nenhum rascunho</span>
                  <div className="flex gap-2.5 mt-2">
                    <Button size="sm" className="gradient-accent text-white text-[11px]" onClick={() => setModal("new")} data-testid="button-drafts-empty-new">
                      <Plus className="w-3.5 h-3.5 mr-1" /> Criar nova automação
                    </Button>
                    <Button variant="outline" size="sm" className="text-[11px]" onClick={() => setModal("builtin-templates")} data-testid="button-drafts-empty-templates">
                      <BookOpen className="w-3.5 h-3.5 mr-1" /> Usar template pronto
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {drafts.map((a) => renderAutoCard(a))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {curAuto && (
        <div className="absolute inset-0 z-30 flex flex-col bg-background" data-testid="flow-editor-overlay">
          <AutomationEditorTabs
            automation={curAuto}
            nodes={nodes}
            selNode={selNode}
            isDirty={isDirty}
            onSelectNode={setSelNode}
            onAddNode={addNode}
            onUpdatePos={updateNodePos}
            onUpdatePosBatch={updateNodePosBatch}
            onUndo={undo}
            undoCount={undoCount}
            onUpdateCfg={updateNodeCfg}
            onUpdateLabel={updateNodeLabel}
            onDeleteNode={deleteNode}
            onAddEdge={addEdge}
            onRemoveEdge={removeEdge}
            onInsertNodeOnEdge={insertNodeOnEdge}
            onQuickAddFromBranch={quickAddFromBranch}
            onSave={saveFlow}
            onTest={testRun}
            onToggle={() => toggleStatus(selIdx!)}
            onRenameName={(newName: string) => {
              if (selIdx === null) return;
              setList((prev) => prev.map((x, i) => (i === selIdx ? { ...x, nome: newName } : x)));
              const a = list[selIdx];
              if (a.id && !a._local) {
                apiRequest("PUT", `/api/automacoes/${a.id}`, { nome: newName }).catch(() => {});
              }
            }}
            onClose={() => { if (isDirty && !confirm("Você tem alterações não salvas. Deseja sair mesmo assim?")) return; setSelIdx(null); setNodes([]); setSelNode(null); undoStackRef.current = []; setUndoCount(0); window.dispatchEvent(new CustomEvent("flowcrm-sidebar-control", { detail: { restore: true } })); }}
          />
        </div>
      )}

      <Dialog open={modal === "rename"} onOpenChange={(v) => { if (!v) { setModal(null); setRenamingIdx(null); } }}>
        <DialogContent data-testid="dialog-rename-automation">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><PenLine className="w-4 h-4" /> Renomear Automação</DialogTitle>
            <DialogDescription>Digite o novo nome para a automação</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && renamingIdx !== null) { confirmRename(renamingIdx); setModal(null); } }}
              data-testid="input-rename-dialog"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setModal(null); setRenamingIdx(null); }}>Cancelar</Button>
            <Button className="gradient-accent text-white" onClick={() => { if (renamingIdx !== null) { confirmRename(renamingIdx); setModal(null); } }} data-testid="button-confirm-rename">Renomear</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modal === "new"} onOpenChange={(v) => !v && setModal(null)}>
        <DialogContent data-testid="dialog-new-automation">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Zap className="w-4 h-4" /> Nova Automação</DialogTitle>
            <DialogDescription>Configure o nome e gatilho da automação</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Input label="Nome da automação" placeholder="Ex: Boas-vindas WhatsApp" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createNew()} autoFocus data-testid="input-new-auto-name" />
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground">Evento disparador</Label>
              <Select value={newTrig} onValueChange={setNewTrig}>
                <SelectTrigger data-testid="select-new-auto-trigger"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRIGGER_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModal(null)} data-testid="button-cancel-new-auto">Cancelar</Button>
            <Button onClick={createNew} className="gradient-accent text-white" data-testid="button-create-auto">Criar e Abrir Editor</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modal === "builtin-templates"} onOpenChange={(v) => !v && setModal(null)}>
        <DialogContent className="max-w-2xl" data-testid="dialog-templates">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><BookOpen className="w-4 h-4" /> Templates Prontos</DialogTitle>
            <DialogDescription>Escolha um template pronto para criar um novo rascunho</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto">
            {TEMPLATES.map((t) => {
              const TplIcon = t.icon;
              return (
                <Card
                  key={t.id}
                  className="p-4 cursor-pointer hover-elevate border-2 border-transparent hover:border-primary/30"
                  onClick={() => useTemplate(t)}
                  data-testid={`button-template-${t.id}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-primary/10 flex-shrink-0">
                      <TplIcon className="w-4.5 h-4.5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-semibold mb-0.5">{t.name}</div>
                      <div className="text-[10.5px] text-muted-foreground mb-2 leading-relaxed">{t.desc}</div>
                      <div className="flex gap-2">
                        <Badge variant="secondary" className="text-[9px]">{t.cat}</Badge>
                        <Badge variant="outline" className="text-[9px]">{t.trigger}</Badge>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={modal === "test"} onOpenChange={(v) => !v && setModal(null)}>
        <DialogContent className="max-w-lg" data-testid="dialog-test-run">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><TestTube className="w-4 h-4" /> Teste de Execução</DialogTitle>
            <DialogDescription>Simulação de execução da automação</DialogDescription>
          </DialogHeader>
          {!testLog ? (
            <div className="py-8 text-center">
              <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
              <div className="text-sm text-muted-foreground">Executando nós...</div>
            </div>
          ) : (
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Execução concluída em {testLog.log.reduce((s, l) => s + l.duration, 0)}ms</span>
              </div>
              {testLog.log.map((entry, i) => {
                const conf = NODE_TYPES[entry.type] || NODE_TYPES.end;
                const Icon = conf.icon;
                return (
                  <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg border bg-card">
                    <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: `${conf.color}18` }}>
                      <Icon className="w-3.5 h-3.5" style={{ color: conf.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold">{entry.label}</span>
                        <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-[9px] text-muted-foreground ml-auto">{entry.duration}ms</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                        {JSON.stringify(entry.output).slice(0, 80)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={listImportOpen} onOpenChange={setListImportOpen}>
        <DialogContent className="sm:max-w-[520px]" style={{ border: "1px solid rgba(88,180,242,0.3)" }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileUp className="w-4 h-4 text-tertiary-600 dark:text-tertiary-500" />
              Importar Agente
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Importe um agente a partir de um arquivo JSON exportado. Uma nova automação será criada automaticamente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <input
                ref={listImportFileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                data-testid="input-list-import-file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    const text = ev.target?.result as string;
                    setListImportJson(text);
                    setListImportError("");
                    try {
                      const parsed = JSON.parse(text);
                      if (parsed._chatbanana_agent && parsed.nome) {
                        setListImportError("");
                      }
                    } catch {}
                  };
                  reader.readAsText(file);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                className="w-full h-20 border-dashed border-2 hover:border-primary/50 transition-colors"
                onClick={() => listImportFileRef.current?.click()}
                data-testid="button-list-upload-agent"
              >
                <div className="flex flex-col items-center gap-1.5">
                  <Upload className="w-5 h-5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Clique para selecionar arquivo .json</span>
                </div>
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] text-muted-foreground uppercase font-bold">ou cole o JSON</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <Textarea
              value={listImportJson}
              onChange={(e) => { setListImportJson(e.target.value); setListImportError(""); }}
              placeholder='{"_chatbanana_agent": true, "nodes": [...]}'
              className="min-h-[120px] text-xs font-mono"
              data-testid="textarea-list-import-json"
            />
            {listImportError && (
              <div className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400 bg-red-500/10 rounded-lg p-2.5">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {listImportError}
              </div>
            )}
            {listImportJson && !listImportError && (
              (() => {
                try {
                  const p = JSON.parse(listImportJson);
                  if (p._chatbanana_agent) return (
                    <div className="rounded-lg border bg-card p-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Share2 className="w-4 h-4 text-tertiary-600 dark:text-tertiary-500" />
                        <span className="text-xs font-bold">{p.nome || "Agente sem nome"}</span>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                        <span>{p.nodes?.length || 0} nós</span>
                        <span>Gatilho: {p.triggerType || "new_message"}</span>
                        {p.exportedAt && <span>Exportado: {new Date(p.exportedAt).toLocaleDateString("pt-BR")}</span>}
                      </div>
                    </div>
                  );
                } catch {}
                return null;
              })()
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setListImportOpen(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              className="gradient-accent text-white"
              disabled={!listImportJson.trim()}
              onClick={() => importAgentToNewAutomation(listImportJson)}
              data-testid="button-list-confirm-import"
            >
              <FileUp className="w-3 h-3 mr-1" /> Criar Agente Importado
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
