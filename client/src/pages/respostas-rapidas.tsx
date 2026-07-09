import { useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MessageInput } from "@/components/ui/message-input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Zap, Plus, Pencil, Trash2, Search, GripVertical, MessageSquare, Copy, Power,
  Image, FileText, Music, Video, Upload, X, Paperclip, Eye, ClipboardCheck, Pin, Shield,
} from "lucide-react";
import { PageHeader } from "@/components/page/PageShell";

function renderWhatsApp(text: string): React.ReactNode {
  if (!text) return null;
  const segments = text.split(/(\*[^*]+\*|_[^_]+_|~[^~]+~)/g);
  return segments.map((seg, i) => {
    if (/^\*[^*]+\*$/.test(seg)) return <strong key={i} className="font-semibold text-foreground">{seg.slice(1, -1)}</strong>;
    if (/^_[^_]+_$/.test(seg)) return <em key={i}>{seg.slice(1, -1)}</em>;
    if (/^~[^~]+~$/.test(seg)) return <s key={i}>{seg.slice(1, -1)}</s>;
    return seg;
  });
}

interface RespostaRapida {
  id: number;
  titulo: string;
  texto: string;
  categoria: string | null;
  atalho: string | null;
  ordem: number;
  ativo: boolean;
  tipoMidia: string | null;
  arquivoUrl: string | null;
  arquivoNome: string | null;
  workspaceId: string | null;
  createdAt: string;
}

const CATEGORIAS = ["Geral", "Vendas", "Suporte", "Follow-up", "Financeiro"];

const MEDIA_TYPES: { value: string; label: string; icon: any; accept: string }[] = [
  { value: "imagem", label: "Imagem", icon: Image, accept: "image/jpeg,image/png,image/gif,image/webp" },
  { value: "pdf", label: "PDF", icon: FileText, accept: "application/pdf" },
  { value: "audio", label: "Áudio", icon: Music, accept: "audio/mpeg,audio/ogg,audio/wav,audio/mp4,audio/aac" },
  { value: "video", label: "Vídeo", icon: Video, accept: "video/mp4,video/webm,video/quicktime" },
];

function mediaIcon(tipo: string | null) {
  switch (tipo) {
    case "imagem": return Image;
    case "pdf": return FileText;
    case "audio": return Music;
    case "video": return Video;
    default: return Paperclip;
  }
}

function mediaLabel(tipo: string | null) {
  switch (tipo) {
    case "imagem": return "Imagem";
    case "pdf": return "PDF";
    case "audio": return "Áudio";
    case "video": return "Vídeo";
    default: return "Arquivo";
  }
}

export default function RespostasRapidas({ embedded }: { embedded?: boolean } = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("todas");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<RespostaRapida | null>(null);
  const [editingItem, setEditingItem] = useState<RespostaRapida | null>(null);
  const [deletingItem, setDeletingItem] = useState<RespostaRapida | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [formTitulo, setFormTitulo] = useState("");
  const [formTexto, setFormTexto] = useState("");
  const [formCategoria, setFormCategoria] = useState("Geral");
  const [formAtalho, setFormAtalho] = useState("");
  const [formAtivo, setFormAtivo] = useState(true);
  const [formTipoMidia, setFormTipoMidia] = useState<string | null>(null);
  const [formArquivoUrl, setFormArquivoUrl] = useState<string | null>(null);
  const [formArquivoNome, setFormArquivoNome] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const query = useQuery<{ ok: boolean; data: RespostaRapida[] }>({
    queryKey: ["/api/respostas-rapidas"],
  });

  const items = query.data?.data || [];

  const isSurveyItem = (r: RespostaRapida) => r.categoria === "Pesquisa" && r.ordem === -1;

  const filtered = items.filter((r) => {
    if (isSurveyItem(r)) return false;
    const matchSearch = !search || r.titulo.toLowerCase().includes(search.toLowerCase()) || r.texto.toLowerCase().includes(search.toLowerCase());
    const matchCat = catFilter === "todas" || r.categoria === catFilter;
    return matchSearch && matchCat;
  }).sort((a, b) => a.ordem - b.ordem);


  function openCreate() {
    setEditingItem(null);
    setFormTitulo("");
    setFormTexto("");
    setFormCategoria("Geral");
    setFormAtalho("");
    setFormAtivo(true);
    setFormTipoMidia(null);
    setFormArquivoUrl(null);
    setFormArquivoNome(null);
    setDialogOpen(true);
  }

  function openEdit(item: RespostaRapida) {
    setEditingItem(item);
    setFormTitulo(item.titulo);
    setFormTexto(item.texto);
    setFormCategoria(item.categoria || "Geral");
    setFormAtalho(item.atalho || "");
    setFormAtivo(item.ativo);
    setFormTipoMidia(item.tipoMidia || null);
    setFormArquivoUrl(item.arquivoUrl || null);
    setFormArquivoNome(item.arquivoNome || null);
    setDialogOpen(true);
  }

  async function handleUpload(file: File, tipoMidia: string) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const resp = await fetch("/api/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = await resp.json();
      if (!data.ok || !data.url) throw new Error(data.error || "Erro no upload");
      setFormTipoMidia(tipoMidia);
      setFormArquivoUrl(data.url);
      setFormArquivoNome(file.name);
      toast({ title: "Arquivo enviado com sucesso" });
    } catch (e: any) {
      toast({ title: "Erro no upload", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    let tipo = "";
    if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) tipo = "imagem";
    else if (ext === "pdf") tipo = "pdf";
    else if (["mp3", "ogg", "wav", "m4a", "aac"].includes(ext)) tipo = "audio";
    else if (["mp4", "webm", "mov"].includes(ext)) tipo = "video";
    else {
      toast({ title: "Formato não suportado", description: "Use imagem, PDF, áudio ou vídeo", variant: "destructive" });
      return;
    }

    const maxSize = tipo === "video" ? 25 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast({ title: "Arquivo muito grande", description: `Máximo: ${tipo === "video" ? "25MB" : "10MB"}`, variant: "destructive" });
      return;
    }

    handleUpload(file, tipo);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeMedia() {
    setFormTipoMidia(null);
    setFormArquivoUrl(null);
    setFormArquivoNome(null);
  }

  async function handleSave() {
    if (!formTitulo.trim() || !formTexto.trim()) {
      toast({ title: "Título e texto são obrigatórios", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        titulo: formTitulo.trim(),
        texto: formTexto.trim(),
        categoria: formCategoria,
        atalho: formAtalho.trim() || null,
        ativo: formAtivo,
        ordem: editingItem ? editingItem.ordem : items.length,
        tipoMidia: formTipoMidia,
        arquivoUrl: formArquivoUrl,
        arquivoNome: formArquivoNome,
      };

      if (editingItem) {
        await apiRequest("PATCH", `/api/respostas-rapidas/${editingItem.id}`, payload);
        toast({ title: "Resposta rápida atualizada" });
      } else {
        await apiRequest("POST", "/api/respostas-rapidas", payload);
        toast({ title: "Resposta rápida criada" });
      }

      queryClient.invalidateQueries({ queryKey: ["/api/respostas-rapidas"] });
      setDialogOpen(false);
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deletingItem) return;
    try {
      await apiRequest("DELETE", `/api/respostas-rapidas/${deletingItem.id}`);
      queryClient.invalidateQueries({ queryKey: ["/api/respostas-rapidas"] });
      toast({ title: "Resposta rápida removida" });
      setDeleteDialogOpen(false);
      setDeletingItem(null);
    } catch (e: any) {
      toast({ title: "Erro ao remover", description: e.message, variant: "destructive" });
    }
  }

  async function toggleAtivo(item: RespostaRapida) {
    try {
      await apiRequest("PATCH", `/api/respostas-rapidas/${item.id}`, { ativo: !item.ativo });
      queryClient.invalidateQueries({ queryKey: ["/api/respostas-rapidas"] });
      toast({ title: item.ativo ? "Resposta desativada" : "Resposta ativada" });
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
  }

  function copyText(texto: string) {
    navigator.clipboard.writeText(texto);
    toast({ title: "Texto copiado" });
  }

  function catColor(cat: string | null): string {
    const map: Record<string, string> = {
      Geral: "#8b5cf6",
      Vendas: "#10b981",
      Suporte: "#FAC209",
      "Follow-up": "#f59e0b",
      Financeiro: "#ef4444",
      Pesquisa: "#10b981",
    };
    return map[cat || ""] || "#6b7280";
  }

  function renderMediaPreview(url: string | null, tipo: string | null, nome: string | null, small?: boolean) {
    if (!url || !tipo) return null;
    const size = small ? "h-10 w-10" : "h-32 w-auto max-w-full";
    if (tipo === "imagem") {
      return <img src={url} alt={nome || "imagem"} className={`${size} object-cover rounded border border-border`} />;
    }
    if (tipo === "video") {
      return (
        <video src={url} className={`${small ? "h-10 w-14" : "h-32 w-auto max-w-full"} rounded border border-border`} controls={!small} muted />
      );
    }
    if (tipo === "audio") {
      if (small) {
        const Icon = Music;
        return <div className="h-10 w-10 rounded border border-border flex items-center justify-center bg-card"><Icon className="w-4 h-4 text-primary" /></div>;
      }
      return <audio src={url} controls className="w-full max-w-xs" />;
    }
    if (tipo === "pdf") {
      const Icon = FileText;
      if (small) {
        return <div className="h-10 w-10 rounded border border-border flex items-center justify-center bg-card"><Icon className="w-4 h-4 text-red-500" /></div>;
      }
      return (
        <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-2 rounded border border-border bg-card hover:bg-accent transition-colors">
          <Icon className="w-5 h-5 text-red-500" />
          <span className="text-xs truncate">{nome || "documento.pdf"}</span>
        </a>
      );
    }
    return null;
  }

  return (
    <div className={embedded ? "px-5 pt-4 space-y-4 flex-1 flex flex-col overflow-hidden" : "p-6 max-w-6xl mx-auto space-y-6 bg-base-200/40 min-h-full"}>
      {!embedded && (
        <PageHeader
          title="Respostas Rápidas"
          subtitle="Gerencie mensagens pré-definidas para uso rápido nas conversas"
          actions={
            <Button
              onClick={openCreate}
              className="h-9 gap-1.5 text-[12px] font-bold"
              data-testid="button-create-quick-reply"
            >
              <Plus className="w-3.5 h-3.5" /> Nova Resposta
            </Button>
          }
        />
      )}
      <div className="flex items-center gap-2.5">
        <div className="relative flex-1 group/search">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70 group-focus-within/search:text-primary transition-colors" />
          <Input
            placeholder="Buscar por título, atalho ou conteúdo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-16 h-9 text-[13px] bg-card/60 border-border/70 focus-visible:border-primary/40 focus-visible:ring-1 focus-visible:ring-primary/20"
            data-testid="input-search-quick-replies"
          />
          {!search && (
            <kbd className="hidden md:inline-flex absolute right-2.5 top-1/2 -translate-y-1/2 items-center gap-0.5 px-1.5 py-0.5 rounded border border-border/60 bg-muted/40 text-[10px] font-mono text-muted-foreground/70 pointer-events-none">
              ⌘K
            </kbd>
          )}
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-[170px] h-9 text-[13px] bg-card/60 border-border/70" data-testid="select-category-filter">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas categorias</SelectItem>
            {CATEGORIAS.map(c => (
              <SelectItem key={c} value={c}>
                <span className="inline-flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: catColor(c) }} />
                  {c}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {embedded && (
          <Button size="sm" className="h-9 px-3 flex-shrink-0" onClick={openCreate} data-testid="button-create-quick-reply">
            <Plus className="w-3.5 h-3.5 mr-1" />Nova Resposta
          </Button>
        )}
      </div>

      {!query.isLoading && items.filter(r => !isSurveyItem(r)).length > 0 && (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground/80 px-0.5 -mt-1">
          <div className="flex items-center gap-3">
            <span className="font-medium tabular-nums text-foreground/80">{filtered.length}</span>
            <span>{filtered.length === 1 ? "resposta" : "respostas"}</span>
            <span className="w-px h-3 bg-border" />
            <span className="tabular-nums">{filtered.filter(r => r.ativo).length} ativas</span>
            {(search || catFilter !== "todas") && filtered.length !== items.filter(r => !isSurveyItem(r)).length && (
              <>
                <span className="w-px h-3 bg-border" />
                <button
                  className="text-primary hover:underline"
                  onClick={() => { setSearch(""); setCatFilter("todas"); }}
                >
                  Limpar filtros
                </button>
              </>
            )}
          </div>
          <span className="text-[10px] opacity-70">Arraste pelo <GripVertical className="inline w-3 h-3 -mt-0.5" /> para reordenar</span>
        </div>
      )}

      {query.isLoading && (
        <div className="space-y-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="p-3.5 border-border/60">
              <div className="flex items-center gap-3">
                <Skeleton className="w-3.5 h-3.5 rounded-sm flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3.5 w-16 rounded" />
                  </div>
                  <Skeleton className="h-2.5 w-3/4" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full flex-shrink-0" />
                <Skeleton className="h-7 w-24 rounded flex-shrink-0" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {!query.isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center border border-dashed border-border/70 rounded-xl bg-card/30">
          <div className="w-14 h-14 rounded-2xl bg-primary/[0.08] flex items-center justify-center mb-4 ring-1 ring-primary/10">
            <MessageSquare className="w-6 h-6 text-primary/70" strokeWidth={1.5} />
          </div>
          <div className="text-[14px] font-semibold text-foreground mb-1">
            {search || catFilter !== "todas" ? "Nenhuma resposta encontrada" : "Nenhuma resposta rápida cadastrada"}
          </div>
          <div className="text-[12px] text-muted-foreground max-w-xs leading-relaxed mb-4">
            {search || catFilter !== "todas"
              ? "Tente termos diferentes ou limpe os filtros pra ver tudo."
              : "Crie respostas pré-definidas que sua equipe pode enviar com atalhos como /ola ou /preco."}
          </div>
          {search || catFilter !== "todas" ? (
            <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => { setSearch(""); setCatFilter("todas"); }}>
              Limpar filtros
            </Button>
          ) : (
            <Button size="sm" className="h-8 text-[12px]" onClick={openCreate}>
              <Plus className="w-3.5 h-3.5 mr-1" />Criar primeira resposta
            </Button>
          )}
        </div>
      )}

      <TooltipProvider delayDuration={200}>
        <div className={embedded ? "flex-1 overflow-y-auto space-y-1.5 pr-0.5" : "space-y-1.5"}>
          {filtered.map((item) => {
            const isPinned = isSurveyItem(item);
            const catHex = isPinned ? "#10b981" : catColor(item.categoria);
            const MediaIcon = item.tipoMidia ? mediaIcon(item.tipoMidia) : null;
            return (
            <Card
              key={item.id}
              className={`group relative p-3 transition-colors duration-150 border-base-200 hover:border-base-300 ${!item.ativo ? "opacity-60" : ""} ${isPinned ? "border-emerald-500/30 bg-emerald-500/[0.03]" : ""}`}
              data-testid={`card-quick-reply-${item.id}`}
            >
              <span
                aria-hidden
                className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: catHex }}
              />
              <div className="flex items-center gap-3">
                <div className={`flex-shrink-0 transition-opacity ${isPinned ? "opacity-100" : "opacity-0 group-hover:opacity-60"} cursor-grab active:cursor-grabbing`}>
                  {isPinned ? <Pin className="w-3.5 h-3.5 text-emerald-500" /> : <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />}
                </div>

                {item.tipoMidia && item.arquivoUrl && (
                  <button
                    type="button"
                    onClick={() => { setPreviewItem(item); setPreviewOpen(true); }}
                    className="flex-shrink-0 rounded-md overflow-hidden ring-1 ring-border/60 hover:ring-primary/40 transition-all"
                    title="Visualizar mídia"
                  >
                    {renderMediaPreview(item.arquivoUrl, item.tipoMidia, item.arquivoNome, true)}
                  </button>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    {isPinned && <ClipboardCheck className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
                    <span
                      className="font-semibold text-[13px] text-foreground truncate"
                      data-testid={`text-reply-title-${item.id}`}
                    >
                      {item.titulo}
                    </span>
                    {item.atalho && (
                      <span className="inline-flex items-center px-1.5 py-0 h-[18px] rounded text-[10.5px] font-mono font-medium text-muted-foreground bg-muted/60 border border-border/50 flex-shrink-0">
                        /{item.atalho}
                      </span>
                    )}
                    {MediaIcon && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded text-primary/80 bg-primary/[0.08] flex-shrink-0">
                            <MediaIcon className="w-3 h-3" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-[11px] py-1 px-2">{mediaLabel(item.tipoMidia)}</TooltipContent>
                      </Tooltip>
                    )}
                    {isPinned && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0 h-[18px] rounded text-[10px] font-medium text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 flex-shrink-0">
                        <Shield className="w-2.5 h-2.5" />
                        Sistema
                      </span>
                    )}
                    {!item.ativo && (
                      <span className="inline-flex items-center px-1.5 py-0 h-[18px] rounded text-[10px] font-medium text-muted-foreground bg-muted/70 flex-shrink-0">
                        Inativo
                      </span>
                    )}
                  </div>
                  <p className="text-[11.5px] text-muted-foreground/85 line-clamp-1 leading-relaxed" data-testid={`text-reply-body-${item.id}`}>
                    {renderWhatsApp(item.texto)}
                  </p>
                </div>

                {item.categoria && (
                  <div
                    className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-medium flex-shrink-0"
                    style={{
                      background: `${catHex}14`,
                      color: catHex,
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: catHex }} />
                    {item.categoria}
                  </div>
                )}

                <div className="flex items-center gap-0.5 flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                  {item.tipoMidia && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 hover:bg-muted"
                          onClick={() => { setPreviewItem(item); setPreviewOpen(true); }}
                          data-testid={`button-preview-${item.id}`}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-[11px] py-1 px-2">Visualizar mídia</TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 hover:bg-muted"
                        onClick={() => copyText(item.texto)}
                        data-testid={`button-copy-${item.id}`}
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-[11px] py-1 px-2">Copiar texto</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-7 w-7 hover:bg-muted ${item.ativo ? "" : "text-muted-foreground/60"}`}
                        onClick={() => toggleAtivo(item)}
                        data-testid={`button-toggle-${item.id}`}
                      >
                        <Power className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-[11px] py-1 px-2">{item.ativo ? "Desativar" : "Ativar"}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 hover:bg-muted"
                        onClick={() => openEdit(item)}
                        data-testid={`button-edit-${item.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-[11px] py-1 px-2">Editar</TooltipContent>
                  </Tooltip>
                  {!isPinned && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          onClick={() => { setDeletingItem(item); setDeleteDialogOpen(true); }}
                          data-testid={`button-delete-${item.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-[11px] py-1 px-2">Remover</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
            </Card>
            );
          })}
        </div>
      </TooltipProvider>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle data-testid="text-dialog-title">
              {editingItem ? "Editar Resposta Rápida" : "Nova Resposta Rápida"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Título</label>
              <Input
                value={formTitulo}
                onChange={(e) => setFormTitulo(e.target.value)}
                placeholder="Ex: Saudação, Preço, Obrigado..."
                data-testid="input-form-titulo"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Texto da resposta</label>
              <MessageInput
                value={formTexto}
                onChange={setFormTexto}
                placeholder="Digite o texto completo da resposta..."
                rows={4}
                variables={["nome", "empresa", "telefone"]}
                data-testid="input-form-texto"
              />
              <div className="text-[10px] text-muted-foreground mt-1 text-right">{formTexto.length} caracteres</div>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide block mb-2">Anexo de Mídia (opcional)</label>
              {formArquivoUrl && formTipoMidia ? (
                <div className="border border-border rounded-lg p-3 bg-card/50">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0">
                      {renderMediaPreview(formArquivoUrl, formTipoMidia, formArquivoNome)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {(() => { const Icon = mediaIcon(formTipoMidia); return <Icon className="w-4 h-4 text-primary" />; })()}
                        <span className="text-xs font-semibold">{mediaLabel(formTipoMidia)}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">{formArquivoNome}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={removeMedia}
                      data-testid="button-remove-media"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="border border-dashed border-border rounded-lg p-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,audio/mpeg,audio/ogg,audio/wav,audio/mp4,audio/aac,video/mp4,video/webm,video/quicktime"
                    onChange={handleFileSelect}
                    className="hidden"
                    data-testid="input-file-upload"
                  />
                  <div className="text-center">
                    <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                    <p className="text-[11px] text-muted-foreground mb-3">
                      Arraste ou clique para enviar um arquivo
                    </p>
                    <div className="flex items-center justify-center gap-2 flex-wrap">
                      {MEDIA_TYPES.map(mt => (
                        <Button
                          key={mt.value}
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] gap-1.5"
                          disabled={uploading}
                          onClick={() => {
                            if (fileInputRef.current) {
                              fileInputRef.current.accept = mt.accept;
                              fileInputRef.current.click();
                            }
                          }}
                          data-testid={`button-upload-${mt.value}`}
                        >
                          <mt.icon className="w-3 h-3" />
                          {mt.label}
                        </Button>
                      ))}
                    </div>
                    {uploading && (
                      <p className="text-[11px] text-primary mt-2 animate-pulse">Enviando arquivo...</p>
                    )}
                    <p className="text-[10px] text-muted-foreground/60 mt-2">
                      Imagem, PDF, Áudio até 10MB · Vídeo até 25MB
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Categoria</label>
                <Select value={formCategoria} onValueChange={setFormCategoria}>
                  <SelectTrigger data-testid="select-form-categoria">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIAS.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Atalho (opcional)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">/</span>
                  <Input
                    value={formAtalho}
                    onChange={(e) => setFormAtalho(e.target.value.replace(/\s/g, "").toLowerCase())}
                    placeholder="saudacao"
                    className="pl-7 font-mono"
                    data-testid="input-form-atalho"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Ativa</label>
              <Switch checked={formAtivo} onCheckedChange={setFormAtivo} data-testid="switch-form-ativo" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-form">
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || uploading} data-testid="button-save-form">
              {saving ? "Salvando..." : editingItem ? "Salvar Alterações" : "Criar Resposta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remover Resposta Rápida</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que deseja remover <span className="font-bold text-foreground">"{deletingItem?.titulo}"</span>? Esta ação não pode ser desfeita.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} data-testid="button-cancel-delete">
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} data-testid="button-confirm-delete">
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{previewItem?.titulo || "Visualizar"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {previewItem?.arquivoUrl && previewItem?.tipoMidia && (
              <div className="flex justify-center">
                {previewItem.tipoMidia === "imagem" && (
                  <img src={previewItem.arquivoUrl} alt={previewItem.arquivoNome || ""} className="max-h-64 rounded-lg border border-border" />
                )}
                {previewItem.tipoMidia === "video" && (
                  <video src={previewItem.arquivoUrl} controls className="max-h-64 rounded-lg border border-border" />
                )}
                {previewItem.tipoMidia === "audio" && (
                  <audio src={previewItem.arquivoUrl} controls className="w-full" />
                )}
                {previewItem.tipoMidia === "pdf" && (
                  <a href={previewItem.arquivoUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-card hover:bg-accent transition-colors">
                    <FileText className="w-8 h-8 text-red-500" />
                    <div>
                      <p className="text-sm font-semibold">{previewItem.arquivoNome || "documento.pdf"}</p>
                      <p className="text-[11px] text-muted-foreground">Clique para abrir</p>
                    </div>
                  </a>
                )}
              </div>
            )}
            <div className="bg-card/50 rounded-lg p-3 border border-border">
              <p className="text-sm whitespace-pre-wrap">{previewItem?.texto}</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
