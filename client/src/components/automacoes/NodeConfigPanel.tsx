import React, { useState, useRef, memo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Zap, Clock, GitBranch, Tag, PenLine, Brain, Flag,
  Pause, Plus, Trash2, X, Check, ChevronRight, ChevronDown, ChevronUp,
  Loader2, List, MessageCircle, CreditCard, Webhook, FileText,
  Upload, Settings2, Eye, EyeOff, Users,
  Variable, GitMerge, Split, Timer, Repeat, Bell,
  FileOutput, Info, Paperclip, Globe, Link, ShieldCheck, Sparkles, Wifi,
  ImagePlus, UserCheck, ExternalLink, MousePointerClick, MessageSquare, Bot,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  FlowNode, NODE_TYPES, NODE_DESCRIPTIONS, TRIGGER_OPTIONS, getNodePreview,
} from "./types";

function SendImageConfig({ nodeId, config: c, onUpdateCfg }: { nodeId: string; config: any; onUpdateCfg: (id: string, field: string, value: any) => void }) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const token = localStorage.getItem("flowcrm_token");
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setUploadError(data.error || "Erro ao enviar arquivo");
        return;
      }
      const isPdf = file.name.toLowerCase().endsWith(".pdf");
      onUpdateCfg(nodeId, "imageUrl", data.url);
      onUpdateCfg(nodeId, "fileType", isPdf ? "pdf" : "image");
      onUpdateCfg(nodeId, "fileName", file.name);
      toast({ title: isPdf ? "PDF enviado" : "Imagem enviada", description: "Arquivo carregado com sucesso." });
    } catch {
      setUploadError("Falha na conexao. Tente novamente.");
    } finally {
      setUploading(false);
    }
  };

  const [dragging, setDragging] = useState(false);
  const currentUrl = c.imageUrl || "";
  const isPdf = c.fileType === "pdf" || currentUrl.toLowerCase().endsWith(".pdf");
  const hasFile = currentUrl && currentUrl.startsWith("http");

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Arquivo (Imagem, Video ou PDF)</Label>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,.pdf,video/mp4,video/quicktime,video/x-msvideo,video/webm,.mp4,.mov,.avi,.webm,.mkv"
          className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); e.target.value = ""; }}
        />
        {!hasFile ? (
          <button
            type="button"
            className={`w-full border-2 border-dashed rounded-lg p-6 flex flex-col items-center gap-2 transition-colors cursor-pointer ${dragging ? "border-primary bg-primary/10" : "border-border/60 hover:border-primary/50 hover:bg-muted/30"}`}
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            data-testid="button-upload-file"
          >
            {uploading ? (
              <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
            ) : (
              <Upload className="w-8 h-8 text-muted-foreground" />
            )}
            <span className="text-xs text-muted-foreground font-medium">
              {uploading ? "Enviando..." : "Clique para enviar imagem ou PDF"}
            </span>
            <span className="text-[10px] text-muted-foreground/60">
              JPG, PNG, WebP, GIF ou PDF (max. 10MB)
            </span>
          </button>
        ) : (
          <div className="rounded-lg overflow-hidden border border-border/50 relative group">
            {isPdf ? (
              <div className="flex items-center gap-3 p-4 bg-muted/30">
                <FileText className="w-10 h-10 text-rose-600 dark:text-rose-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{c.fileName || "documento.pdf"}</p>
                  <p className="text-[10px] text-muted-foreground">Documento PDF</p>
                </div>
              </div>
            ) : (
              <img
                src={currentUrl}
                alt="Preview"
                className="w-full max-h-[140px] object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
            <div className="absolute top-1.5 right-1.5 flex gap-1">
              <button
                className="p-1 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => fileRef.current?.click()}
                title="Trocar arquivo"
              >
                <Upload className="w-3 h-3" />
              </button>
              <button
                className="p-1 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => { onUpdateCfg(nodeId, "imageUrl", ""); onUpdateCfg(nodeId, "fileType", ""); onUpdateCfg(nodeId, "fileName", ""); }}
                title="Remover arquivo"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </div>
      {uploadError && (
        <div className="text-[10px] text-destructive bg-destructive/10 p-2 rounded-lg font-bold">
          {uploadError}
        </div>
      )}
      <div>
        <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Legenda (opcional)</Label>
        <Textarea
          ref={captionRef}
          className="text-xs resize-y min-h-[60px] leading-relaxed"
          placeholder="Texto que acompanha o arquivo..."
          value={c.caption || ""}
          onChange={(e) => onUpdateCfg(nodeId, "caption", e.target.value)}
          data-testid="textarea-image-caption"
        />
        <VariableChips
          textareaRef={captionRef}
          value={c.caption || ""}
          onChange={(v) => onUpdateCfg(nodeId, "caption", v)}
          variables={["nome", "empresa", "telefone"]}
        />
      </div>
      <div className="text-[10px] text-muted-foreground p-2.5 bg-muted/30 rounded-lg leading-relaxed">
        Envie uma imagem ou PDF do seu computador.<br />
        A legenda aparecera abaixo do arquivo no WhatsApp.
      </div>
    </div>
  );
}

export function ImplementarPrompt({ currentPrompt, onApply }: { currentPrompt: string; onApply: (newPrompt: string) => void }) {
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const { toast } = useToast();

  const handleImplement = async () => {
    if (!instruction.trim()) return;
    if (!currentPrompt.trim()) {
      toast({ title: "Prompt vazio", description: "Escreva um prompt antes de implementar alteracoes.", variant: "destructive" });
      return;
    }
    setLoading(true);
    setPreview(null);
    try {
      const res = await fetch("/api/ai/implement-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("flowcrm_token") || ""}` },
        body: JSON.stringify({ currentPrompt, implementation: instruction.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erro desconhecido" }));
        throw new Error(err.error || "Erro ao processar");
      }
      const data = await res.json();
      if (data.newPrompt) {
        setPreview(data.newPrompt);
      }
    } catch (err: any) {
      toast({ title: "Erro", description: err.message || "Falha ao implementar", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (preview) {
      onApply(preview);
      setPreview(null);
      setInstruction("");
      toast({ title: "Implementado!", description: "O prompt foi atualizado com sucesso." });
    }
  };

  const handleDiscard = () => {
    setPreview(null);
  };

  return (
    <div className="space-y-3">
      {!preview ? (
        <>
          <Textarea
            className="text-sm resize-y min-h-[80px] leading-relaxed"
            placeholder={"Descreva a mudanca que deseja no prompt...\n\nEx: A partir de agora, antes de iniciar o atendimento, pergunte se ja e cliente.\nEx: Mude o tom para mais descontraido e extrovertido.\nEx: Adicione regra para sempre perguntar o endereco de entrega."}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            disabled={loading}
            data-testid="textarea-implement-prompt"
          />
          <div className="flex items-center justify-between">
            <p className="text-[9.5px] text-muted-foreground max-w-[65%]">
              Descreva a alteracao desejada. A IA ira modificar apenas o necessario no prompt atual.
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleImplement}
              disabled={loading || !instruction.trim() || !currentPrompt.trim()}
              className="gap-1.5 text-xs bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-600 hover:to-amber-600 text-black font-bold"
              data-testid="btn-implement-prompt"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {loading ? "Processando..." : "Implementar"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Eye className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span className="text-[10px] font-bold uppercase text-amber-600 dark:text-amber-400">Pre-visualizacao do prompt modificado</span>
            </div>
            <div className="text-xs text-foreground/80 font-mono whitespace-pre-wrap max-h-[300px] overflow-y-auto leading-relaxed">
              {preview}
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={handleDiscard}
              className="gap-1.5 text-xs"
              data-testid="btn-discard-implementation"
            >
              <X className="w-3.5 h-3.5" />
              Descartar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleApply}
              className="gap-1.5 text-xs bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 text-white font-bold"
              data-testid="btn-apply-implementation"
            >
              <Check className="w-3.5 h-3.5" />
              Aplicar ao Prompt
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export function AiFilesConfig({ nodeId, config: c, onUpdateCfg }: { nodeId: string; config: any; onUpdateCfg: (id: string, field: string, value: any) => void }) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const files: { id: string; name: string; description: string; url: string; fileType: string; originalName: string }[] = c.aiFiles || [];

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const token = localStorage.getItem("flowcrm_token");
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast({ title: "Erro", description: data.error || "Erro ao enviar arquivo", variant: "destructive" });
        return;
      }
      const lower = file.name.toLowerCase();
      const isPdf = lower.endsWith(".pdf");
      const isVideo = lower.endsWith(".mp4") || lower.endsWith(".mov") || lower.endsWith(".avi") || lower.endsWith(".webm") || lower.endsWith(".mkv");
      const newFile = {
        id: `f_${Date.now()}`,
        name: "",
        description: "",
        url: data.url,
        fileType: isPdf ? "pdf" : isVideo ? "video" : "image",
        originalName: file.name,
      };
      onUpdateCfg(nodeId, "aiFiles", [...files, newFile]);
      toast({ title: "Arquivo adicionado", description: file.name });
    } catch {
      toast({ title: "Erro", description: "Falha ao enviar arquivo", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const updateFile = (fileId: string, field: string, value: string) => {
    const updated = files.map(f => f.id === fileId ? { ...f, [field]: value } : f);
    onUpdateCfg(nodeId, "aiFiles", updated);
  };

  const removeFile = (fileId: string) => {
    onUpdateCfg(nodeId, "aiFiles", files.filter(f => f.id !== fileId));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  };

  return (
    <div className="space-y-3">
      <div className="text-[10px] text-muted-foreground p-2 bg-muted/30 rounded-lg leading-relaxed">
        Faca upload de imagens, videos e PDFs. De um nome descritivo para que a IA saiba quando enviar cada arquivo durante a conversa.
      </div>

      {files.map((f) => (
        <div key={f.id} className="rounded-lg border border-border/50 bg-card/50 p-3 space-y-2 relative group">
          <button
            onClick={() => removeFile(f.id)}
            className="absolute top-1.5 right-1.5 p-0.5 rounded bg-destructive/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"
            data-testid={`button-remove-ai-file-${f.id}`}
          >
            <X className="w-3 h-3" />
          </button>

          <div className="flex items-center gap-2">
            {f.fileType === "pdf" ? (
              <FileText className="w-6 h-6 text-rose-600 dark:text-rose-400 shrink-0" />
            ) : f.fileType === "video" ? (
              <video src={f.url} className="w-10 h-10 rounded object-cover shrink-0" muted />
            ) : (
              <img src={f.url} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
            )}
            <span className="text-[10px] text-muted-foreground truncate flex-1">{f.originalName}</span>
          </div>

          <div>
            <Label className="text-[9.5px] uppercase font-bold text-muted-foreground block mb-0.5">Nome do arquivo</Label>
            <Input
              className="text-xs h-7"
              placeholder="Ex: Cardapio, Tabela de Precos, Planos"
              value={f.name}
              onChange={(e) => updateFile(f.id, "name", e.target.value)}
              data-testid={`input-ai-file-name-${f.id}`}
            />
          </div>

          <div>
            <Label className="text-[9.5px] uppercase font-bold text-muted-foreground block mb-0.5">Descricao (quando enviar)</Label>
            <Input
              className="text-xs h-7"
              placeholder="Ex: Enviar quando pedir cardapio ou menu"
              value={f.description}
              onChange={(e) => updateFile(f.id, "description", e.target.value)}
              data-testid={`input-ai-file-desc-${f.id}`}
            />
          </div>
        </div>
      ))}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,.pdf,video/mp4,video/quicktime,video/x-msvideo,video/webm,.mp4,.mov,.avi,.webm,.mkv"
        className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); e.target.value = ""; }}
      />
      <button
        type="button"
        className="w-full border-2 border-dashed rounded-lg p-4 flex flex-col items-center gap-1.5 transition-colors cursor-pointer border-border/60 hover:border-primary/50 hover:bg-muted/30"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); }}
        data-testid="button-upload-ai-file"
      >
        {uploading ? (
          <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
        ) : (
          <Upload className="w-5 h-5 text-muted-foreground" />
        )}
        <span className="text-[10px] text-muted-foreground font-medium">
          {uploading ? "Enviando..." : "Adicionar imagem, video ou PDF"}
        </span>
      </button>
    </div>
  );
}

export function AiWebhooksConfig({ nodeId, config: c, onUpdateCfg }: { nodeId: string; config: any; onUpdateCfg: (id: string, field: string, value: any) => void }) {
  const webhooks: { id: string; name: string; description: string; url: string; method: string; headers: string; bodyTemplate: string; responseKey: string }[] = c.aiWebhooks || [];

  const addWebhook = () => {
    const newWh = {
      id: `wh_${Date.now()}`,
      name: "",
      description: "",
      url: "",
      method: "GET",
      headers: "",
      bodyTemplate: "",
      responseKey: "",
    };
    onUpdateCfg(nodeId, "aiWebhooks", [...webhooks, newWh]);
  };

  const updateWebhook = (whId: string, field: string, value: string) => {
    const updated = webhooks.map(w => w.id === whId ? { ...w, [field]: value } : w);
    onUpdateCfg(nodeId, "aiWebhooks", updated);
  };

  const removeWebhook = (whId: string) => {
    onUpdateCfg(nodeId, "aiWebhooks", webhooks.filter(w => w.id !== whId));
  };

  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="text-[10px] text-muted-foreground p-2 bg-muted/30 rounded-lg leading-relaxed">
        Configure webhooks que a IA pode chamar durante a conversa. Ex: consultar pedido, verificar estoque, buscar dados.
      </div>

      {webhooks.map((wh) => (
        <div key={wh.id} className="rounded-lg border border-border/50 bg-card/50 overflow-hidden relative group">
          <button
            onClick={() => removeWebhook(wh.id)}
            className="absolute top-1.5 right-1.5 p-0.5 rounded bg-destructive/80 text-white opacity-0 group-hover:opacity-100 transition-opacity z-10"
            data-testid={`button-remove-ai-webhook-${wh.id}`}
          >
            <X className="w-3 h-3" />
          </button>

          <button
            onClick={() => setExpandedId(expandedId === wh.id ? null : wh.id)}
            className="w-full flex items-center gap-2 p-3 text-left hover:bg-muted/20 transition-colors"
          >
            <Globe className="w-4 h-4 text-pink-600 dark:text-pink-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-bold truncate">{wh.name || "Webhook sem nome"}</div>
              <div className="text-[9.5px] text-muted-foreground truncate">{wh.url || "Configure a URL"}</div>
            </div>
            <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform ${expandedId === wh.id ? "rotate-180" : ""}`} />
          </button>

          {expandedId === wh.id && (
            <div className="p-3 pt-0 space-y-2 border-t border-border/30">
              <div>
                <Label className="text-[9.5px] uppercase font-bold text-muted-foreground block mb-0.5">Nome da acao</Label>
                <Input
                  className="text-xs h-7"
                  placeholder="Ex: Consultar Pedido, Verificar Estoque"
                  value={wh.name}
                  onChange={(e) => updateWebhook(wh.id, "name", e.target.value)}
                  data-testid={`input-ai-wh-name-${wh.id}`}
                />
              </div>
              <div>
                <Label className="text-[9.5px] uppercase font-bold text-muted-foreground block mb-0.5">Quando usar (descricao para a IA)</Label>
                <Input
                  className="text-xs h-7"
                  placeholder="Ex: Quando o cliente perguntar sobre o pedido"
                  value={wh.description}
                  onChange={(e) => updateWebhook(wh.id, "description", e.target.value)}
                  data-testid={`input-ai-wh-desc-${wh.id}`}
                />
              </div>
              <div className="grid grid-cols-[80px_1fr] gap-2">
                <div>
                  <Label className="text-[9.5px] uppercase font-bold text-muted-foreground block mb-0.5">Metodo</Label>
                  <select
                    className="w-full bg-card border border-border rounded h-7 text-[11px] text-foreground outline-none px-1"
                    value={wh.method}
                    onChange={(e) => updateWebhook(wh.id, "method", e.target.value)}
                    data-testid={`select-ai-wh-method-${wh.id}`}
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="PATCH">PATCH</option>
                  </select>
                </div>
                <div>
                  <Label className="text-[9.5px] uppercase font-bold text-muted-foreground block mb-0.5">URL da API</Label>
                  <Input
                    className="text-xs h-7 font-mono"
                    placeholder="https://api.sistema.com/pedidos/{{telefone}}"
                    value={wh.url}
                    onChange={(e) => updateWebhook(wh.id, "url", e.target.value)}
                    data-testid={`input-ai-wh-url-${wh.id}`}
                  />
                </div>
              </div>
              <div>
                <Label className="text-[9.5px] uppercase font-bold text-muted-foreground block mb-0.5">Headers (JSON, opcional)</Label>
                <Textarea
                  className="text-[10px] resize-y min-h-[40px] font-mono leading-relaxed"
                  placeholder={'{"Authorization": "Bearer token_aqui"}'}
                  value={wh.headers}
                  onChange={(e) => updateWebhook(wh.id, "headers", e.target.value)}
                  data-testid={`textarea-ai-wh-headers-${wh.id}`}
                />
              </div>
              {(wh.method === "POST" || wh.method === "PUT" || wh.method === "PATCH") && (
                <div>
                  <Label className="text-[9.5px] uppercase font-bold text-muted-foreground block mb-0.5">Body (JSON, opcional)</Label>
                  <Textarea
                    className="text-[10px] resize-y min-h-[40px] font-mono leading-relaxed"
                    placeholder={'{"cpf": "{{cpf}}", "telefone": "{{telefone}}"}'}
                    value={wh.bodyTemplate}
                    onChange={(e) => updateWebhook(wh.id, "bodyTemplate", e.target.value)}
                    data-testid={`textarea-ai-wh-body-${wh.id}`}
                  />
                </div>
              )}
              <div>
                <Label className="text-[9.5px] uppercase font-bold text-muted-foreground block mb-0.5">Campo da resposta (opcional)</Label>
                <Input
                  className="text-xs h-7 font-mono"
                  placeholder="Ex: data.resultado (vazio = resposta inteira)"
                  value={wh.responseKey}
                  onChange={(e) => updateWebhook(wh.id, "responseKey", e.target.value)}
                  data-testid={`input-ai-wh-response-key-${wh.id}`}
                />
              </div>
              <div className="text-[9px] text-muted-foreground/70 p-1.5 bg-muted/20 rounded leading-relaxed">
                Variaveis disponiveis na URL e body: {"{{nome}}"}, {"{{telefone}}"}, {"{{email}}"}, {"{{empresa}}"}, {"{{canal}}"}
              </div>
            </div>
          )}
        </div>
      ))}

      <button
        type="button"
        className="w-full border-2 border-dashed rounded-lg p-3 flex items-center justify-center gap-1.5 transition-colors cursor-pointer border-border/60 hover:border-primary/50 hover:bg-muted/30"
        onClick={addWebhook}
        data-testid="button-add-ai-webhook"
      >
        <Plus className="w-4 h-4 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground font-medium">Adicionar webhook</span>
      </button>
    </div>
  );
}


function VariableChips({
  textareaRef,
  value,
  onChange,
  variables,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (newValue: string) => void;
  variables: string[];
}) {
  const insertVariable = (varName: string) => {
    const tag = `{{${varName}}}`;
    const el = textareaRef.current;
    if (el) {
      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;
      const newVal = value.substring(0, start) + tag + value.substring(end);
      onChange(newVal);
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + tag.length;
        el.setSelectionRange(pos, pos);
      });
    } else {
      onChange(value + tag);
    }
  };

  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {variables.map((v) => (
        <button
          key={v}
          type="button"
          className="px-2 py-0.5 rounded-md text-[9.5px] font-mono bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 hover:border-primary/40 transition-colors cursor-pointer"
          onClick={() => insertVariable(v)}
          title={`Inserir {{${v}}}`}
          data-testid={`var-chip-${v}`}
        >
          {`{{${v}}}`}
        </button>
      ))}
    </div>
  );
}

export const ConfigPanel = memo(function ConfigPanel({
  node, onUpdateCfg, onUpdateLabel, onDelete, onClose,
  atendentes, equipesLista, editorPipelines, editorStages, activePipelines,
}: {
  node: FlowNode;
  onUpdateCfg: (id: string, field: string, value: any) => void;
  onUpdateLabel: (id: string, label: string) => void;
  onDelete: () => void;
  onClose: () => void;
  atendentes?: any[];
  equipesLista?: any[];
  editorPipelines?: any[];
  editorStages?: any[];
  activePipelines?: any[];
}) {
  const conf = NODE_TYPES[node.type] || NODE_TYPES.end;
  const Icon = conf.icon;
  const c = node.config || {};
  const msgTextareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="w-[280px] flex-shrink-0 bg-card border-l overflow-y-auto flex flex-col" data-testid="auto-node-config">
      <div className="px-4 py-3 border-b flex items-center gap-2 flex-shrink-0" style={{ background: `${conf.color}10` }}>
        <Icon className="w-5 h-5" style={{ color: conf.color }} />
        <div className="flex-1 min-w-0">
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="flex items-center gap-1.5 group cursor-pointer text-left"
                title="Informacao"
                data-testid="button-node-info"
              >
                <span className="text-xs font-semibold" style={{ color: conf.color }}>{conf.label}</span>
                <Info className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150" style={{ color: conf.color }} />
              </button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="start" className="w-[260px] p-3">
              <div className="flex items-center gap-2 mb-2">
                <Icon className="w-4 h-4 flex-shrink-0" style={{ color: conf.color }} />
                <span className="text-xs font-semibold" style={{ color: conf.color }}>{conf.label}</span>
              </div>
              <div className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-line">
                {NODE_DESCRIPTIONS[node.type] || "Bloco de automacao."}
              </div>
            </PopoverContent>
          </Popover>
          <div className="text-[9.5px] text-muted-foreground">ID: {node.id}</div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onDelete} title="Excluir no" data-testid="button-delete-node">
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} data-testid="button-close-config">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="p-4 flex-1">
        <div className="mb-3">
          <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Rotulo do no</Label>
          <Input className="text-xs" value={node.label} onChange={(e) => onUpdateLabel(node.id, e.target.value)} data-testid="input-node-label" />
        </div>

        {node.type === "trigger" && (
          <div className="space-y-3">
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Evento disparador</Label>
              <Select value={c.triggerType || "new_message"} onValueChange={(v) => onUpdateCfg(node.id, "triggerType", v)}>
                <SelectTrigger className="text-xs" data-testid="select-trigger-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRIGGER_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Canal (opcional)</Label>
              <Select value={c.channel || "all"} onValueChange={(v) => onUpdateCfg(node.id, "channel", v)}>
                <SelectTrigger className="text-xs" data-testid="select-trigger-channel"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                  <SelectItem value="chat">Webchat</SelectItem>
                  <SelectItem value="email">E-mail</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {node.type === "send_message" && (
          <div className="space-y-3">
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Canal de envio</Label>
              <Select value={c.channel || "whatsapp"} onValueChange={(v) => onUpdateCfg(node.id, "channel", v)}>
                <SelectTrigger className="text-xs" data-testid="select-msg-channel"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                  <SelectItem value="chat">Webchat</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Tipo de mensagem</Label>
              <Select value={c.msgType || "text"} onValueChange={(v) => onUpdateCfg(node.id, "msgType", v)}>
                <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Texto livre</SelectItem>
                  <SelectItem value="template">Template aprovado</SelectItem>
                  <SelectItem value="image">Imagem</SelectItem>
                  <SelectItem value="audio">Audio</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Mensagem</Label>
              <Textarea
                ref={msgTextareaRef}
                className="text-xs resize-y min-h-[100px] leading-relaxed"
                placeholder={"Ola {{nome}}!\n\nEm que posso te ajudar?"}
                value={c.content || ""}
                onChange={(e) => onUpdateCfg(node.id, "content", e.target.value)}
                data-testid="textarea-msg-content"
              />
              <VariableChips
                textareaRef={msgTextareaRef}
                value={c.content || ""}
                onChange={(v) => onUpdateCfg(node.id, "content", v)}
                variables={["nome", "empresa", "telefone", "canal", "valor"]}
              />
            </div>
          </div>
        )}

        {node.type === "send_image" && (
          <SendImageConfig
            nodeId={node.id}
            config={c}
            onUpdateCfg={onUpdateCfg}
          />
        )}

        {node.type === "delay" && (
          <div className="flex gap-2.5">
            <div className="flex-1">
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Valor</Label>
              <Input className="text-xs" type="number" min={1} value={c.value || 5} onChange={(e) => onUpdateCfg(node.id, "value", +e.target.value)} data-testid="input-delay-value" />
            </div>
            <div className="flex-1">
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Unidade</Label>
              <Select value={c.unit || "minutes"} onValueChange={(v) => onUpdateCfg(node.id, "unit", v)}>
                <SelectTrigger className="text-xs" data-testid="select-delay-unit"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="seconds">Segundos</SelectItem>
                  <SelectItem value="minutes">Minutos</SelectItem>
                  <SelectItem value="hours">Horas</SelectItem>
                  <SelectItem value="days">Dias</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {node.type === "condition" && (
          <div className="space-y-3">
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Campo a verificar</Label>
              <Select value={c.field || ""} onValueChange={(v) => onUpdateCfg(node.id, "field", v)}>
                <SelectTrigger className="text-xs" data-testid="select-condition-field"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="content">Conteudo da mensagem</SelectItem>
                  <SelectItem value="canal">Canal de origem</SelectItem>
                  <SelectItem value="status">Status do contato</SelectItem>
                  <SelectItem value="tag">Tags do contato</SelectItem>
                  <SelectItem value="replied">Respondeu a mensagem</SelectItem>
                  <SelectItem value="aiScore">Score da IA</SelectItem>
                  <SelectItem value="aiReply">Resposta da IA</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Operador</Label>
              <Select value={c.operator || "eq"} onValueChange={(v) => onUpdateCfg(node.id, "operator", v)}>
                <SelectTrigger className="text-xs" data-testid="select-condition-op"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="eq">E igual a</SelectItem>
                  <SelectItem value="neq">Nao e igual a</SelectItem>
                  <SelectItem value="contains">Contem</SelectItem>
                  <SelectItem value="not_contains">Nao contem</SelectItem>
                  <SelectItem value="gt">Maior que</SelectItem>
                  <SelectItem value="lt">Menor que</SelectItem>
                  <SelectItem value="is_empty">Esta vazio</SelectItem>
                  <SelectItem value="not_empty">Nao esta vazio</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!["is_empty", "not_empty"].includes(c.operator) && (
              <div>
                <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Valor de comparacao</Label>
                <Input className="text-xs" placeholder="Ex: HOT, GANHO, whatsapp..." value={c.value || ""} onChange={(e) => onUpdateCfg(node.id, "value", e.target.value)} data-testid="input-condition-value" />
              </div>
            )}
            <div className="text-[10.5px] text-muted-foreground p-2.5 bg-muted/30 rounded-lg leading-relaxed flex items-start gap-1.5">
              <GitBranch className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>Clique em <b className="text-emerald-600 dark:text-emerald-400">Sim</b> ou <b className="text-rose-600 dark:text-rose-400">Nao</b> no no do canvas para conectar cada saida.</span>
            </div>
          </div>
        )}

        {node.type === "tag_lead" && (
          <div className="space-y-3">
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Tags (separadas por virgula)</Label>
              <Input
                className="text-xs"
                placeholder="lead-quente, proposta-enviada"
                value={(c.tags as string[] || []).join(", ")}
                onChange={(e) => onUpdateCfg(node.id, "tags", e.target.value.split(",").map((t: string) => t.trim()).filter(Boolean))}
                data-testid="input-tags"
              />
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Acao</Label>
              <Select value={c.action || "add"} onValueChange={(v) => onUpdateCfg(node.id, "action", v)}>
                <SelectTrigger className="text-xs" data-testid="select-tag-action"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="add">Adicionar tag</SelectItem>
                  <SelectItem value="remove">Remover tag</SelectItem>
                  <SelectItem value="replace">Substituir todas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {node.type === "assign_agent" && (
          <div className="space-y-3">
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Estrategia de atribuicao</Label>
              <Select value={c.strategy || "round_robin"} onValueChange={(v) => onUpdateCfg(node.id, "strategy", v)}>
                <SelectTrigger className="text-xs" data-testid="select-assign-strategy"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="round_robin">Round Robin (alternado)</SelectItem>
                  <SelectItem value="least_busy">Menos ocupado</SelectItem>
                  <SelectItem value="specific">Atendente especifico</SelectItem>
                  <SelectItem value="ai">IA decide</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {c.strategy === "specific" && (
              <div>
                <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Atendente</Label>
                <Select value={c.agentId?.toString() || ""} onValueChange={(v) => {
                  const user = (atendentes ?? []).find((u: any) => u.id.toString() === v);
                  onUpdateCfg(node.id, "agentId", parseInt(v));
                  onUpdateCfg(node.id, "agentName", user?.nome || "");
                }}>
                  <SelectTrigger className="text-xs" data-testid="select-assign-agent">
                    <SelectValue placeholder="Selecione um atendente..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(atendentes ?? []).map((u: any) => (
                      <SelectItem key={u.id} value={u.id.toString()}>
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[9px] font-bold flex-shrink-0">
                            {u.nome?.charAt(0)?.toUpperCase() || "?"}
                          </div>
                          <span>{u.nome}</span>
                          {u.cargo && <span className="text-muted-foreground text-[10px] ml-1">({u.cargo})</span>}
                        </div>
                      </SelectItem>
                    ))}
                    {(atendentes ?? []).length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">Nenhum atendente cadastrado</div>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Equipe (opcional)</Label>
              <Select value={c.teamId || ""} onValueChange={(v) => {
                if (v === "__none__") {
                  onUpdateCfg(node.id, "teamId", "");
                  onUpdateCfg(node.id, "team", "");
                } else {
                  const team = (equipesLista ?? []).find((t: any) => t.id === v);
                  onUpdateCfg(node.id, "teamId", v);
                  onUpdateCfg(node.id, "team", team?.nome || "");
                }
              }}>
                <SelectTrigger className="text-xs" data-testid="select-assign-team">
                  <SelectValue placeholder="Selecione uma equipe..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    <span className="text-muted-foreground">Nenhuma (todos os atendentes)</span>
                  </SelectItem>
                  {(equipesLista ?? []).map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>
                      <div className="flex items-center gap-2">
                        <Users className="w-3.5 h-3.5 text-primary/60 flex-shrink-0" />
                        <span>{t.nome}</span>
                        {t.members && <span className="text-muted-foreground text-[10px] ml-1">({t.members.length} membros)</span>}
                      </div>
                    </SelectItem>
                  ))}
                  {(equipesLista ?? []).length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">Nenhuma equipe cadastrada</div>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {node.type === "update_lead" && (() => {
          const pipes = activePipelines || [];
          const stages = editorStages || [];
          const selectedPipKey = c.pipeline || "";
          const stagesForPipeline = selectedPipKey
            ? (() => { const f = stages.filter((s: any) => s.pipeline === selectedPipKey); return f.length > 0 ? f : stages; })()
            : [];
          return (
            <div className="space-y-3">
              <div>
                <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Pipeline</Label>
                <Select
                  value={selectedPipKey}
                  onValueChange={(v) => {
                    const pip = pipes.find((p: any) => p.key === v);
                    onUpdateCfg(node.id, "pipeline", v);
                    onUpdateCfg(node.id, "pipelineLabel", pip?.label || v);
                    onUpdateCfg(node.id, "stage", "");
                    onUpdateCfg(node.id, "stageLabel", "");
                  }}
                >
                  <SelectTrigger className="text-xs" data-testid="select-pipeline">
                    <SelectValue placeholder="Selecione a pipeline..." />
                  </SelectTrigger>
                  <SelectContent>
                    {pipes.map((p: any) => (
                      <SelectItem key={p.key} value={p.key}>
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ background: p.cor || "#8B5CF6" }} />
                          {p.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedPipKey && (
                <div>
                  <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Etapa</Label>
                  {stagesForPipeline.length === 0 ? (
                    <div className="text-[10.5px] text-muted-foreground p-2 bg-muted/30 rounded-lg">
                      Nenhuma etapa cadastrada nesta pipeline.
                    </div>
                  ) : (
                    <Select
                      value={c.stage ? String(c.stage) : ""}
                      onValueChange={(v) => {
                        const stg = stagesForPipeline.find((s: any) => String(s.id) === v);
                        onUpdateCfg(node.id, "stage", v);
                        onUpdateCfg(node.id, "stageLabel", stg?.label || v);
                      }}
                    >
                      <SelectTrigger className="text-xs" data-testid="select-stage">
                        <SelectValue placeholder="Selecione a etapa..." />
                      </SelectTrigger>
                      <SelectContent>
                        {stagesForPipeline.map((s: any) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            <span className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full" style={{ background: s.color || "#6b7280" }} />
                              {s.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {selectedPipKey && c.stage && (
                <div className="text-[10px] text-muted-foreground p-2.5 bg-muted/30 rounded-lg leading-relaxed flex items-start gap-1.5">
                  <PenLine className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "#2dd4bf" }} />
                  <span>Ao executar, o lead sera movido para a etapa <strong>{c.stageLabel}</strong> da pipeline <strong>{c.pipelineLabel}</strong>.</span>
                </div>
              )}
            </div>
          );
        })()}

        {node.type === "ai_response" && (
          <div className="space-y-3">
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Modelo de IA</Label>
              <Select value={c.model || "gpt-4o-mini"} onValueChange={(v) => onUpdateCfg(node.id, "model", v)}>
                <SelectTrigger className="text-xs" data-testid="select-ai-model"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4o-mini">GPT-4o Mini (rapido)</SelectItem>
                  <SelectItem value="gpt-4o">GPT-4o (mais capaz)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Prompt do sistema</Label>
              <Textarea
                className="text-xs resize-y min-h-[90px] leading-relaxed"
                placeholder="Voce e um assistente de vendas. Responda em portugues de forma objetiva."
                value={c.systemPrompt || ""}
                onChange={(e) => onUpdateCfg(node.id, "systemPrompt", e.target.value)}
                data-testid="textarea-ai-prompt"
              />
            </div>
            <ImplementarPrompt
              currentPrompt={c.systemPrompt || ""}
              onApply={(newPrompt) => onUpdateCfg(node.id, "systemPrompt", newPrompt)}
            />
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Salvar resposta em (variavel)</Label>
              <Input className="text-xs" placeholder="aiReply" value={c.saveAs || "aiReply"} onChange={(e) => onUpdateCfg(node.id, "saveAs", e.target.value)} />
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Temperatura: {c.temperature ?? 0.5}</Label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={c.temperature ?? 0.5}
                className="w-full accent-primary"
                onChange={(e) => onUpdateCfg(node.id, "temperature", +e.target.value)}
              />
              <div className="flex justify-between text-[9.5px] text-muted-foreground mt-0.5">
                <span>Preciso</span><span>Criativo</span>
              </div>
            </div>
            <AiFilesConfig nodeId={node.id} config={c} onUpdateCfg={onUpdateCfg} />
            <AiWebhooksConfig nodeId={node.id} config={c} onUpdateCfg={onUpdateCfg} />
          </div>
        )}

        {node.type === "webhook" && (
          <div className="space-y-3">
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">URL do endpoint</Label>
              <Input className="text-xs" placeholder="https://meu-sistema.com/webhook" value={c.url || ""} onChange={(e) => onUpdateCfg(node.id, "url", e.target.value)} data-testid="input-webhook-url" />
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Metodo HTTP</Label>
              <Select value={c.method || "POST"} onValueChange={(v) => onUpdateCfg(node.id, "method", v)}>
                <SelectTrigger className="text-xs" data-testid="select-webhook-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                  <SelectItem value="PATCH">PATCH</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Headers (JSON)</Label>
              <Textarea
                className="text-xs resize-y min-h-[60px] font-mono"
                placeholder={'{"Authorization": "Bearer token"}'}
                value={c.headers || ""}
                onChange={(e) => onUpdateCfg(node.id, "headers", e.target.value)}
              />
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Payload (JSON)</Label>
              <Textarea
                className="text-xs resize-y min-h-[70px] font-mono"
                placeholder={'{"nome": "{{nome}}", "canal": "{{canal}}"}'}
                value={c.payload || ""}
                onChange={(e) => onUpdateCfg(node.id, "payload", e.target.value)}
              />
            </div>
          </div>
        )}

        {node.type === "lista_opcoes" && (
          <ListaOpcoesConfig node={node} onUpdateCfg={onUpdateCfg} />
        )}



        {node.type === "stripe_payment" && (
          <div className="space-y-3">
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Descricao do produto</Label>
              <Input className="text-xs" placeholder="Consultoria inicial" value={c.description || ""} onChange={(e) => onUpdateCfg(node.id, "description", e.target.value)} data-testid="input-stripe-desc" />
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Valor (R$)</Label>
              <Input
                className="text-xs"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="197,00"
                value={c.display_amount || ""}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  onUpdateCfg(node.id, "display_amount", e.target.value);
                  onUpdateCfg(node.id, "amount", isNaN(val) ? 0 : Math.round(val * 100));
                }}
                data-testid="input-stripe-amount"
              />
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Salvar link em variavel</Label>
              <Input className="text-xs" placeholder="link_pagamento" value={c.save_link_to || ""} onChange={(e) => onUpdateCfg(node.id, "save_link_to", e.target.value)} data-testid="input-stripe-save-var" />
              <p className="text-[9.5px] text-muted-foreground mt-1">Use {"{{variables.link_pagamento}}"} no no Enviar Mensagem</p>
            </div>
            {(c.description || c.display_amount) && (
              <div className="text-[10.5px] p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-600 dark:text-emerald-400 font-semibold text-center">
                R$ {c.display_amount ? parseFloat(c.display_amount).toFixed(2).replace(".", ",") : "0,00"} — {c.description || "Sem descricao"}
              </div>
            )}
            <div className="text-[10px] text-muted-foreground p-2.5 bg-muted/30 rounded-lg leading-relaxed flex items-start gap-1.5">
              <CreditCard className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "#10B981" }} />
              <span>Cria um Payment Link no Stripe e salva a URL nas variaveis do fluxo.</span>
            </div>
          </div>
        )}


        {node.type === "engine_isp" && (
          <div className="space-y-3">
            <div className="text-[10px] p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg text-muted-foreground leading-relaxed">
              <div className="font-bold text-orange-600 dark:text-orange-400 mb-2 flex items-center gap-1.5"><Bot className="w-3.5 h-3.5" /> Engine ISP Autônoma</div>
              <p className="mb-1.5">A Engine ISP processa cada mensagem do cliente de forma inteligente e autônoma:</p>
              <ul className="list-disc list-inside space-y-0.5 text-[9.5px]">
                <li>Saudação e identificação por CPF/CNPJ</li>
                <li>Classificação de departamento via IA</li>
                <li>Financeiro: boletos, 2ª via, desbloqueio, PIX</li>
                <li>Suporte: chamados técnicos, status de conexão</li>
                <li>Comercial: planos, cobertura, instalação</li>
                <li>Cancelamento: retenção, registro</li>
              </ul>
            </div>
            <div className="text-[9.5px] p-2.5 bg-orange-500/10 border border-orange-500/20 rounded-lg text-muted-foreground leading-relaxed">
              <div className="font-bold text-orange-600 dark:text-orange-400 mb-1 flex items-center gap-1"><Bot className="w-3 h-3" /> Variáveis disponíveis após execução:</div>
              <span>{"{{engine_isp_success}}"}, {"{{engine_isp_intent}}"}, {"{{engine_isp_response}}"}, {"{{engine_isp_prompt}}"}</span>
            </div>
          </div>
        )}

        {node.type === "isp_action" && (
          <div className="space-y-3">
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Ação</Label>
              <Select value={c.action || "search_customer"} onValueChange={(v) => onUpdateCfg(node.id, "action", v)}>
                <SelectTrigger className="text-xs" data-testid="select-isp-action"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="search_customer">🔍 Buscar Cliente por CPF</SelectItem>
                  <SelectItem value="get_invoices">📄 Listar Boletos em Aberto</SelectItem>
                  <SelectItem value="second_copy">🧾 Gerar 2ª Via de Boleto</SelectItem>
                  <SelectItem value="trust_unlock">🔓 Desbloqueio de Confiança</SelectItem>
                  <SelectItem value="payment_confirmed">✅ Confirmar Pagamento</SelectItem>
                  <SelectItem value="payment_promise">📅 Promessa de Pagamento</SelectItem>
                  <SelectItem value="service_order">📋 Ordem de Serviço</SelectItem>
                  <SelectItem value="create_ticket">🔧 Abrir Chamado Técnico</SelectItem>
                  <SelectItem value="get_ticket_status">📊 Consultar Status do Chamado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(c.action === "search_customer" || !c.action) && (
              <div>
                <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Variável do CPF</Label>
                <Input className="text-xs" placeholder="{{cpf}}" value={c.cpf_variable || "{{cpf}}"} onChange={(e) => onUpdateCfg(node.id, "cpf_variable", e.target.value)} data-testid="input-isp-cpf-var" />
              </div>
            )}
            {c.action === "get_invoices" && (
              <div>
                <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Variável do ID do cliente</Label>
                <Input className="text-xs" placeholder="{{isp_customer_id}}" value={c.customer_id_variable || "{{isp_customer_id}}"} onChange={(e) => onUpdateCfg(node.id, "customer_id_variable", e.target.value)} data-testid="input-isp-customer-var" />
              </div>
            )}
            {c.action === "second_copy" && (
              <div>
                <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Variável do ID da fatura</Label>
                <Input className="text-xs" placeholder="{{isp_invoice_id}}" value={c.invoice_id_variable || "{{isp_invoice_id}}"} onChange={(e) => onUpdateCfg(node.id, "invoice_id_variable", e.target.value)} data-testid="input-isp-invoice-var" />
              </div>
            )}
            {c.action === "service_order" && (
              <>
                <div>
                  <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Variável do Contrato</Label>
                  <Input className="text-xs" placeholder="{{isp_contrato_id}}" value={c.contract_id_variable || "{{isp_contrato_id}}"} onChange={(e) => onUpdateCfg(node.id, "contract_id_variable", e.target.value)} data-testid="input-isp-os-contract-var" />
                </div>
                <div>
                  <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Assunto</Label>
                  <Input className="text-xs" placeholder="Sem sinal / Lentidão / Fibra rompida" value={c.os_assunto || ""} onChange={(e) => onUpdateCfg(node.id, "os_assunto", e.target.value)} data-testid="input-isp-os-assunto" />
                </div>
                <div>
                  <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Descrição do problema</Label>
                  <Textarea className="text-xs min-h-[50px]" placeholder="Descreva o problema técnico..." value={c.os_descricao || ""} onChange={(e) => onUpdateCfg(node.id, "os_descricao", e.target.value)} data-testid="input-isp-os-descricao" />
                </div>
              </>
            )}
            {(c.action === "trust_unlock" || c.action === "payment_confirmed" || c.action === "payment_promise") && (
              <>
                <div>
                  <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Variável do ID do Cliente</Label>
                  <Input className="text-xs" placeholder="{{isp_customer_id}}" value={c.customer_id_variable || "{{isp_customer_id}}"} onChange={(e) => onUpdateCfg(node.id, "customer_id_variable", e.target.value)} data-testid="input-isp-action-customer-var" />
                </div>
                <div>
                  <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Variável do Contrato</Label>
                  <Input className="text-xs" placeholder="{{isp_contrato_id}}" value={c.contract_id_variable || "{{isp_contrato_id}}"} onChange={(e) => onUpdateCfg(node.id, "contract_id_variable", e.target.value)} data-testid="input-isp-action-contract-var" />
                </div>
                {c.action === "payment_confirmed" && (
                  <div>
                    <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Variável do ID da Fatura</Label>
                    <Input className="text-xs" placeholder="{{isp_invoice_id}}" value={c.invoice_id_variable || "{{isp_invoice_id}}"} onChange={(e) => onUpdateCfg(node.id, "invoice_id_variable", e.target.value)} data-testid="input-isp-action-invoice-var" />
                  </div>
                )}
                {c.action === "payment_promise" && (
                  <div>
                    <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Variável do ID da Fatura (opcional)</Label>
                    <Input className="text-xs" placeholder="{{isp_invoice_id}}" value={c.invoice_id_variable || "{{isp_invoice_id}}"} onChange={(e) => onUpdateCfg(node.id, "invoice_id_variable", e.target.value)} data-testid="input-isp-action-promise-invoice-var" />
                  </div>
                )}
              </>
            )}
            {c.action === "create_ticket" && (
              <>
                <div>
                  <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Tipo de chamado</Label>
                  <Select value={c.ticket_type || "sem_sinal"} onValueChange={(v) => onUpdateCfg(node.id, "ticket_type", v)}>
                    <SelectTrigger className="text-xs" data-testid="select-isp-ticket-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sem_sinal">Sem Sinal</SelectItem>
                      <SelectItem value="lentidao">Lentidão</SelectItem>
                      <SelectItem value="sem_wifi">Sem WiFi</SelectItem>
                      <SelectItem value="financeiro">Financeiro</SelectItem>
                      <SelectItem value="outros">Outros</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Descrição</Label>
                  <Textarea className="text-xs min-h-[50px]" placeholder="Descreva o problema..." value={c.description || ""} onChange={(e) => onUpdateCfg(node.id, "description", e.target.value)} data-testid="input-isp-ticket-desc" />
                </div>
              </>
            )}
            {c.action === "get_ticket_status" && (
              <div>
                <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">ID do chamado</Label>
                <Input className="text-xs" placeholder="{{isp_ticket_id}}" value={c.ticket_id_variable || "{{isp_ticket_id}}"} onChange={(e) => onUpdateCfg(node.id, "ticket_id_variable", e.target.value)} data-testid="input-isp-ticket-var" />
              </div>
            )}
            <div className="text-[9.5px] p-2.5 bg-sky-500/10 border border-sky-500/20 rounded-lg text-muted-foreground leading-relaxed">
              <div className="font-bold text-sky-600 dark:text-sky-400 mb-1 flex items-center gap-1"><Wifi className="w-3 h-3" /> Variáveis disponíveis após execução:</div>
              {(c.action === "search_customer" || !c.action) && <span>{"{{isp_customer_nome}}"}, {"{{isp_customer_id}}"}, {"{{isp_customer_plano}}"}, {"{{isp_customer_status}}"}, {"{{isp_success}}"}</span>}
              {c.action === "get_invoices" && <span>{"{{isp_invoices_count}}"}, {"{{isp_has_debt}}"}, {"{{isp_invoice_valor}}"}, {"{{isp_invoice_vencimento}}"}, {"{{isp_linha_digitavel}}"}, {"{{isp_link_boleto}}"}, {"{{isp_pix}}"}</span>}
              {c.action === "second_copy" && <span>{"{{isp_linha_digitavel}}"}, {"{{isp_link_boleto}}"}, {"{{isp_pix}}"}, {"{{isp_invoice_valor}}"}</span>}
              {c.action === "trust_unlock" && <span>{"{{isp_unlock_success}}"}, {"{{isp_unlock_message}}"}, {"{{isp_success}}"}</span>}
              {c.action === "payment_confirmed" && <span>{"{{isp_payment_success}}"}, {"{{isp_payment_message}}"}, {"{{isp_success}}"}</span>}
              {c.action === "payment_promise" && <span>{"{{isp_promise_protocolo}}"}, {"{{isp_promise_liberado}}"}, {"{{isp_success}}"}</span>}
              {c.action === "service_order" && <span>{"{{isp_os_id}}"}, {"{{isp_os_protocolo}}"}, {"{{isp_success}}"}</span>}
              {c.action === "create_ticket" && <span>{"{{isp_ticket_protocolo}}"}, {"{{isp_ticket_id}}"}, {"{{isp_success}}"}</span>}
              {c.action === "get_ticket_status" && <span>{"{{isp_ticket_status}}"}, {"{{isp_ticket_protocolo}}"}, {"{{isp_success}}"}</span>}
            </div>
          </div>
        )}

        {node.type === "isp_unlock" && (
          <div className="space-y-3">
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Tipo de Desbloqueio</Label>
              <Select value={c.unlock_action || "trust_unlock"} onValueChange={(v) => onUpdateCfg(node.id, "unlock_action", v)}>
                <SelectTrigger className="text-xs" data-testid="select-isp-unlock-action"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="trust_unlock">🔓 Desbloqueio de Confiança</SelectItem>
                  <SelectItem value="payment_confirmed">✅ Confirmar Pagamento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Variável do ID do Cliente</Label>
              <Input className="text-xs" placeholder="{{isp_customer_id}}" value={c.customer_id_variable || "{{isp_customer_id}}"} onChange={(e) => onUpdateCfg(node.id, "customer_id_variable", e.target.value)} data-testid="input-unlock-customer-var" />
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Variável do Contrato</Label>
              <Input className="text-xs" placeholder="{{isp_contrato_id}}" value={c.contract_id_variable || "{{isp_contrato_id}}"} onChange={(e) => onUpdateCfg(node.id, "contract_id_variable", e.target.value)} data-testid="input-unlock-contract-var" />
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Variável do Telefone</Label>
              <Input className="text-xs" placeholder="{{customerPhone}}" value={c.phone_variable || "{{customerPhone}}"} onChange={(e) => onUpdateCfg(node.id, "phone_variable", e.target.value)} data-testid="input-unlock-phone-var" />
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Variável do Nome</Label>
              <Input className="text-xs" placeholder="{{isp_customer_nome}}" value={c.name_variable || "{{isp_customer_nome}}"} onChange={(e) => onUpdateCfg(node.id, "name_variable", e.target.value)} data-testid="input-unlock-name-var" />
            </div>
            {(c.unlock_action === "payment_confirmed") && (
              <div>
                <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Variável do ID da Fatura</Label>
                <Input className="text-xs" placeholder="{{isp_invoice_id}}" value={c.invoice_id_variable || "{{isp_invoice_id}}"} onChange={(e) => onUpdateCfg(node.id, "invoice_id_variable", e.target.value)} data-testid="input-unlock-invoice-var" />
              </div>
            )}
            <div className="text-[9.5px] p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-muted-foreground leading-relaxed">
              <div className="font-bold text-emerald-600 dark:text-emerald-400 mb-1 flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Variáveis disponíveis após execução:</div>
              <span>{"{{isp_unlock_success}}"}, {"{{isp_unlock_message}}"}, {"{{isp_unlock_blocked}}"}, {"{{isp_unlock_block_reason}}"}</span>
            </div>
          </div>
        )}

        {node.type === "set_variable" && (
          <div className="space-y-3">
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Nome da variavel</Label>
              <Input className="text-xs" placeholder="nome_cliente" value={c.variable_name || ""} onChange={(e) => onUpdateCfg(node.id, "variable_name", e.target.value)} data-testid="input-var-name" />
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Valor</Label>
              <Input className="text-xs" placeholder="{{lead.nome}} ou texto fixo" value={c.variable_value || ""} onChange={(e) => onUpdateCfg(node.id, "variable_value", e.target.value)} data-testid="input-var-value" />
              <p className="text-[9px] text-muted-foreground mt-1">Use {"{{lead.nome}}"}, {"{{lead.email}}"}, {"{{variables.outra}}"}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Tipo</Label>
                <Select value={c.variable_type || "text"} onValueChange={(v) => onUpdateCfg(node.id, "variable_type", v)}>
                  <SelectTrigger className="text-xs" data-testid="select-var-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Texto</SelectItem>
                    <SelectItem value="number">Numero</SelectItem>
                    <SelectItem value="boolean">Sim/Nao</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Escopo</Label>
                <Select value={c.variable_scope || "session"} onValueChange={(v) => onUpdateCfg(node.id, "variable_scope", v)}>
                  <SelectTrigger className="text-xs" data-testid="select-var-scope"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="session">Sessao (temporaria)</SelectItem>
                    <SelectItem value="lead">Contato (persistente)</SelectItem>
                    <SelectItem value="global">Global (workspace)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground p-2.5 bg-cyan-500/10 border border-cyan-500/20 rounded-lg leading-relaxed flex items-start gap-1.5">
              <Variable className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-cyan-600 dark:text-cyan-400" />
              <span>Define uma variavel que pode ser usada em blocos seguintes via {"{{variables.nome}}"}. Variaveis de escopo "Contato" ficam salvas permanentemente.</span>
            </div>
          </div>
        )}

        {node.type === "advanced_condition" && (
          <div className="space-y-3">
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Logica entre grupos</Label>
              <Select value={c.group_logic || "AND"} onValueChange={(v) => onUpdateCfg(node.id, "group_logic", v)}>
                <SelectTrigger className="text-xs" data-testid="select-group-logic"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="AND">E (todas verdadeiras)</SelectItem>
                  <SelectItem value="OR">OU (pelo menos uma)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(c.condition_groups || [{ logic: "AND", conditions: [{ field: "", operator: "eq", value: "" }] }]).map((group: any, gi: number) => (
              <div key={gi} className="rounded-xl border bg-card/50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase">Grupo {gi + 1}</span>
                  <div className="flex items-center gap-2">
                    <Select value={group.logic || "AND"} onValueChange={(v) => {
                      const groups = [...(c.condition_groups || [{ logic: "AND", conditions: [{ field: "", operator: "eq", value: "" }] }])];
                      groups[gi] = { ...groups[gi], logic: v };
                      onUpdateCfg(node.id, "condition_groups", groups);
                    }}>
                      <SelectTrigger className="text-[10px] h-6 w-16" data-testid={`select-group-${gi}-logic`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AND">E</SelectItem>
                        <SelectItem value="OR">OU</SelectItem>
                      </SelectContent>
                    </Select>
                    {gi > 0 && (
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => {
                        const groups = [...(c.condition_groups || [])];
                        groups.splice(gi, 1);
                        onUpdateCfg(node.id, "condition_groups", groups);
                      }} data-testid={`button-remove-group-${gi}`}><Trash2 className="w-3 h-3" /></Button>
                    )}
                  </div>
                </div>
                {(group.conditions || []).map((cond: any, ci: number) => (
                  <div key={ci} className="grid grid-cols-[1fr_auto_1fr_auto] gap-1 items-end">
                    <Input className="text-[10px] h-7" placeholder="lead.status" value={cond.field || ""} onChange={(e) => {
                      const groups = [...(c.condition_groups || [{ logic: "AND", conditions: [{ field: "", operator: "eq", value: "" }] }])];
                      groups[gi].conditions[ci] = { ...cond, field: e.target.value };
                      onUpdateCfg(node.id, "condition_groups", groups);
                    }} data-testid={`input-cond-${gi}-${ci}-field`} />
                    <Select value={cond.operator || "eq"} onValueChange={(v) => {
                      const groups = [...(c.condition_groups || [{ logic: "AND", conditions: [{ field: "", operator: "eq", value: "" }] }])];
                      groups[gi].conditions[ci] = { ...cond, operator: v };
                      onUpdateCfg(node.id, "condition_groups", groups);
                    }}>
                      <SelectTrigger className="text-[10px] h-7 w-20" data-testid={`select-cond-${gi}-${ci}-op`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="eq">=</SelectItem>
                        <SelectItem value="neq">!=</SelectItem>
                        <SelectItem value="gt">&gt;</SelectItem>
                        <SelectItem value="lt">&lt;</SelectItem>
                        <SelectItem value="contains">contem</SelectItem>
                        <SelectItem value="not_contains">nao contem</SelectItem>
                        <SelectItem value="is_empty">vazio</SelectItem>
                        <SelectItem value="not_empty">preenchido</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input className="text-[10px] h-7" placeholder="valor" value={cond.value || ""} onChange={(e) => {
                      const groups = [...(c.condition_groups || [{ logic: "AND", conditions: [{ field: "", operator: "eq", value: "" }] }])];
                      groups[gi].conditions[ci] = { ...cond, value: e.target.value };
                      onUpdateCfg(node.id, "condition_groups", groups);
                    }} data-testid={`input-cond-${gi}-${ci}-value`} />
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                      const groups = [...(c.condition_groups || [])];
                      groups[gi].conditions.splice(ci, 1);
                      if (groups[gi].conditions.length === 0) groups[gi].conditions.push({ field: "", operator: "eq", value: "" });
                      onUpdateCfg(node.id, "condition_groups", groups);
                    }} data-testid={`button-remove-cond-${gi}-${ci}`}><X className="w-3 h-3" /></Button>
                  </div>
                ))}
                <Button variant="ghost" size="sm" className="text-[10px] h-6 w-full" onClick={() => {
                  const groups = [...(c.condition_groups || [{ logic: "AND", conditions: [{ field: "", operator: "eq", value: "" }] }])];
                  groups[gi].conditions.push({ field: "", operator: "eq", value: "" });
                  onUpdateCfg(node.id, "condition_groups", groups);
                }} data-testid={`button-add-cond-${gi}`}><Plus className="w-3 h-3 mr-1" /> Condicao</Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="text-[10px] h-7 w-full" onClick={() => {
              const groups = [...(c.condition_groups || [{ logic: "AND", conditions: [{ field: "", operator: "eq", value: "" }] }])];
              groups.push({ logic: "AND", conditions: [{ field: "", operator: "eq", value: "" }] });
              onUpdateCfg(node.id, "condition_groups", groups);
            }} data-testid="button-add-group"><Plus className="w-3 h-3 mr-1" /> Adicionar Grupo</Button>
            <div className="text-[10px] text-muted-foreground p-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg leading-relaxed flex items-start gap-1.5">
              <GitMerge className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <span>Campos: <b>lead.status</b>, <b>lead.valor</b>, <b>lead.canal</b>, <b>lead.tags</b>, <b>variables.nome</b>. Saidas: Sim / Nao.</span>
            </div>
          </div>
        )}

        {node.type === "split_ia" && (
          <div className="space-y-3">
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Categorias (uma por linha)</Label>
              <Textarea className="text-xs min-h-[60px]" placeholder={"vendas\nsuporte\nfinanceiro\nagendamento"} value={(c.categories || []).join("\n")} onChange={(e) => onUpdateCfg(node.id, "categories", e.target.value.split("\n").map((s: string) => s.trim()).filter(Boolean))} data-testid="input-split-categories" />
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Prompt de classificacao (opcional)</Label>
              <Textarea className="text-xs min-h-[50px]" placeholder="Classifique a intencao do cliente..." value={c.classify_prompt || ""} onChange={(e) => onUpdateCfg(node.id, "classify_prompt", e.target.value)} data-testid="input-split-prompt" />
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Modelo</Label>
              <Select value={c.model || "gpt-4o-mini"} onValueChange={(v) => onUpdateCfg(node.id, "model", v)}>
                <SelectTrigger className="text-xs" data-testid="select-split-model"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                  <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">OpenAI API Key</Label>
              <Input className="text-xs font-mono" type="password" placeholder="sk-... (deixe vazio para usar a chave da Integracao)" value={c.openaiApiKey || ""} onChange={(e) => onUpdateCfg(node.id, "openaiApiKey", e.target.value)} data-testid="input-split-openai-key" />
              {!c.openaiApiKey && (
                <div className="flex items-center gap-2 rounded-lg p-1.5 bg-primary/10 mt-1.5">
                  <Settings2 className="w-3 h-3 text-primary" />
                  <span className="text-[9px] font-bold text-primary">Usando chave principal da Integracao</span>
                </div>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground p-2.5 bg-primary/10 border border-primary/20 rounded-lg leading-relaxed flex items-start gap-1.5">
              <Split className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-tertiary-600 dark:text-tertiary-500" />
              <span>A IA classifica a mensagem do cliente e direciona para a categoria correspondente. Conecte cada saida de categoria no canvas.</span>
            </div>
          </div>
        )}

        {node.type === "wait_event" && (
          <div className="space-y-3">
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Tipo de evento</Label>
              <Select value={c.event_type || "client_reply"} onValueChange={(v) => onUpdateCfg(node.id, "event_type", v)}>
                <SelectTrigger className="text-xs" data-testid="select-wait-event-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="client_reply">Resposta do cliente</SelectItem>
                  <SelectItem value="payment_confirmed">Pagamento confirmado</SelectItem>
                  <SelectItem value="webhook_received">Webhook recebido</SelectItem>
                  <SelectItem value="tag_added">Tag adicionada</SelectItem>
                  <SelectItem value="stage_changed">Etapa alterada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Timeout (minutos)</Label>
              <Input className="text-xs" type="number" min="1" max="10080" value={c.timeout_minutes || 60} onChange={(e) => onUpdateCfg(node.id, "timeout_minutes", parseInt(e.target.value) || 60)} data-testid="input-wait-timeout" />
              <p className="text-[9px] text-muted-foreground mt-1">Maximo: 10080 min (7 dias). Apos o timeout, segue pelo caminho "Timeout".</p>
            </div>
            <div className="text-[10px] text-muted-foreground p-2.5 bg-sky-500/10 border border-sky-500/20 rounded-lg leading-relaxed flex items-start gap-1.5">
              <Timer className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-sky-600 dark:text-sky-400" />
              <span>O fluxo pausa e aguarda o evento selecionado. Se expirar, segue pelo caminho de timeout.</span>
            </div>
          </div>
        )}

        {node.type === "loop" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Max tentativas</Label>
                <Input className="text-xs" type="number" min="1" max="100" value={c.max_attempts || 5} onChange={(e) => onUpdateCfg(node.id, "max_attempts", parseInt(e.target.value) || 5)} data-testid="input-loop-max" />
              </div>
              <div>
                <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Intervalo</Label>
                <div className="flex gap-1">
                  <Input className="text-xs w-14" type="number" min="1" value={c.interval_value || 1} onChange={(e) => onUpdateCfg(node.id, "interval_value", parseInt(e.target.value) || 1)} data-testid="input-loop-interval" />
                  <Select value={c.interval_unit || "hours"} onValueChange={(v) => onUpdateCfg(node.id, "interval_unit", v)}>
                    <SelectTrigger className="text-[10px] flex-1" data-testid="select-loop-unit"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minutes">min</SelectItem>
                      <SelectItem value="hours">horas</SelectItem>
                      <SelectItem value="days">dias</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Parar quando (campo)</Label>
              <Input className="text-xs" placeholder="variables.respondeu ou lead.status" value={c.stop_field || ""} onChange={(e) => onUpdateCfg(node.id, "stop_field", e.target.value)} data-testid="input-loop-stop-field" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Operador</Label>
                <Select value={c.stop_operator || "eq"} onValueChange={(v) => onUpdateCfg(node.id, "stop_operator", v)}>
                  <SelectTrigger className="text-[10px]" data-testid="select-loop-op"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="eq">=</SelectItem>
                    <SelectItem value="neq">!=</SelectItem>
                    <SelectItem value="not_empty">preenchido</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Valor</Label>
                <Input className="text-xs" placeholder="true" value={c.stop_value || ""} onChange={(e) => onUpdateCfg(node.id, "stop_value", e.target.value)} data-testid="input-loop-stop-value" />
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg leading-relaxed flex items-start gap-1.5">
              <Repeat className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <span>Repete ate a condicao ser atendida ou atingir o maximo de tentativas. Saida "Sim" = condicao atingida, "Nao" = maximo esgotado.</span>
            </div>
          </div>
        )}

        {node.type === "alerta_interno" && (
          <div className="space-y-3">
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Titulo do alerta</Label>
              <Input className="text-xs" placeholder="Contato quente sem atendimento!" value={c.alert_title || ""} onChange={(e) => onUpdateCfg(node.id, "alert_title", e.target.value)} data-testid="input-alert-title" />
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Mensagem</Label>
              <Textarea className="text-xs min-h-[50px]" placeholder="O lead {{lead.nome}} precisa de atencao..." value={c.alert_message || ""} onChange={(e) => onUpdateCfg(node.id, "alert_message", e.target.value)} data-testid="input-alert-message" />
              <p className="text-[9px] text-muted-foreground mt-1">Use {"{{lead.nome}}"}, {"{{lead.valor}}"}, {"{{variables.xxx}}"}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Prioridade</Label>
                <Select value={c.alert_priority || "media"} onValueChange={(v) => onUpdateCfg(node.id, "alert_priority", v)}>
                  <SelectTrigger className="text-xs" data-testid="select-alert-priority"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="baixa">Baixa</SelectItem>
                    <SelectItem value="media">Media</SelectItem>
                    <SelectItem value="alta">Alta</SelectItem>
                    <SelectItem value="urgente">Urgente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Destino</Label>
                <Select value={c.dest_type || "user"} onValueChange={(v) => onUpdateCfg(node.id, "dest_type", v)}>
                  <SelectTrigger className="text-xs" data-testid="select-alert-dest"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Usuario especifico</SelectItem>
                    <SelectItem value="team">Equipe</SelectItem>
                    <SelectItem value="all">Todos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {c.dest_type === "user" && (
              <div>
                <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Usuario</Label>
                <Select value={c.dest_id?.toString() || ""} onValueChange={(v) => onUpdateCfg(node.id, "dest_id", v)}>
                  <SelectTrigger className="text-xs" data-testid="select-alert-user"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {(atendentes ?? []).map((u: any) => (
                      <SelectItem key={u.id} value={u.id.toString()}>{u.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {c.dest_type === "team" && (
              <div>
                <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Equipe</Label>
                <Select value={c.dest_id?.toString() || ""} onValueChange={(v) => onUpdateCfg(node.id, "dest_id", v)}>
                  <SelectTrigger className="text-xs" data-testid="select-alert-team"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {(equipesLista ?? []).map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="text-[10px] text-muted-foreground p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg leading-relaxed flex items-start gap-1.5">
              <Bell className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
              <span>Envia uma notificacao interna para usuarios ou equipes. Aparece no sino de notificacoes do sistema.</span>
            </div>
          </div>
        )}

        {node.type === "gerar_documento" && (
          <div className="space-y-3">
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Template</Label>
              <Input className="text-xs" placeholder="ID do template" value={c.template_id || ""} onChange={(e) => onUpdateCfg(node.id, "template_id", e.target.value)} data-testid="input-doc-template" />
              <p className="text-[9px] text-muted-foreground mt-1">ID do template cadastrado em Configuracoes → Templates</p>
            </div>
            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Nome do documento</Label>
              <Input className="text-xs" placeholder="Proposta - {{lead.nome}}" value={c.document_name || ""} onChange={(e) => onUpdateCfg(node.id, "document_name", e.target.value)} data-testid="input-doc-name" />
            </div>
            <div className="text-[10px] text-muted-foreground p-2.5 bg-primary/10 border border-primary/20 rounded-lg leading-relaxed flex items-start gap-1.5">
              <FileOutput className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-tertiary-600 dark:text-tertiary-500" />
              <span>Gera um documento HTML a partir do template selecionado, substituindo variaveis como {"{{lead.nome}}"}, {"{{lead.valor}}"}. O HTML fica em {"{{variables.last_document_html}}"}.</span>
            </div>
          </div>
        )}

        {node.type === "end" && (
          <div className="p-3 bg-muted/30 rounded-lg text-xs text-muted-foreground leading-relaxed text-center flex items-center justify-center gap-2">
            <Flag className="w-4 h-4" /> Fim do fluxo. Nenhuma configuracao necessaria.
          </div>
        )}

        <div className="mt-4 pt-3 border-t">
          <div className="text-[10px] font-bold text-muted-foreground uppercase mb-2 tracking-wider">Conexoes de saida</div>
          {(node.next || []).length === 0 && !node.nextTrue && !node.nextFalse && !Object.keys(node.nextOptions || {}).length && !node.nextTextInput ? (
            <div className="text-[11px] text-muted-foreground">Nenhuma conexao configurada.</div>
          ) : (
            <div className="space-y-1">
              {(node.next || []).map((id) => (
                <div key={id} className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <ChevronRight className="w-3 h-3" /> {id}
                </div>
              ))}
              {node.nextTrue && <div className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><Check className="w-3 h-3" /> Sim {"→"} {node.nextTrue}</div>}
              {node.nextFalse && <div className="text-[11px] text-rose-600 dark:text-rose-400 flex items-center gap-1"><X className="w-3 h-3" /> Nao {"→"} {node.nextFalse}</div>}
              {Object.entries(node.nextOptions || {}).map(([optId, toId]) => {
                const opts = (node.config?.options || []) as { id: string; label: string }[];
                const opt = opts.find(o => o.id === optId);
                return (
                  <div key={optId} className="text-[11px] flex items-center gap-1" style={{ color: "#8B5CF6" }}>
                    <ChevronRight className="w-3 h-3" /> {opt?.label || optId} {"→"} {toId}
                  </div>
                );
              })}
              {node.nextTextInput && <div className="text-[11px] flex items-center gap-1" style={{ color: "#94a3b8" }}><MessageCircle className="w-3 h-3" /> Texto livre {"→"} {node.nextTextInput}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

function ListaOpcoesConfig({
  node,
  onUpdateCfg,
}: {
  node: FlowNode;
  onUpdateCfg: (id: string, field: string, value: any) => void;
}) {
  const c = node.config || {};
  const options: { id: string; label: string; description?: string; pipeline?: string }[] = c.options || [];
  const listStyle = c.list_style || "list";

  const { data: pipelines = [] } = useQuery<{ id: number; key: string; label: string }[]>({
    queryKey: ["/api/pipelines"],
  });

  const STYLE_OPTIONS = [
    { value: "list", label: "Lista interativa", desc: "Menu expansivel com ate 10 opcoes", icon: List, maxOptions: 10 },
    { value: "buttons", label: "Botoes", desc: "Botoes clicaveis com ate 3 opcoes", icon: MousePointerClick, maxOptions: 3 },
    { value: "text", label: "Texto numerado", desc: "Mensagem de texto com opcoes numeradas", icon: MessageSquare, maxOptions: 10 },
  ];

  const currentStyle = STYLE_OPTIONS.find(s => s.value === listStyle) || STYLE_OPTIONS[0];
  const maxOptions = currentStyle.maxOptions;

  function addOption() {
    if (options.length >= maxOptions) return;
    const existingIds = options.map(o => o.id);
    let idx = options.length + 1;
    while (existingIds.includes(`opt_${idx}`)) idx++;
    const newOpt = { id: `opt_${idx}`, label: "", description: "" };
    onUpdateCfg(node.id, "options", [...options, newOpt]);
  }

  function removeOption(idx: number) {
    const updated = options.filter((_, i) => i !== idx);
    onUpdateCfg(node.id, "options", updated);
  }

  function updateOption(idx: number, field: string, value: string) {
    const updated = options.map((opt, i) => (i === idx ? { ...opt, [field]: value } : opt));
    onUpdateCfg(node.id, "options", updated);
  }

  function handleStyleChange(newStyle: string) {
    onUpdateCfg(node.id, "list_style", newStyle);
    const newMax = STYLE_OPTIONS.find(s => s.value === newStyle)?.maxOptions || 10;
    if (options.length > newMax) {
      onUpdateCfg(node.id, "options", options.slice(0, newMax));
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1.5">Estilo da lista</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {STYLE_OPTIONS.map((style) => {
            const Icon = style.icon;
            const isActive = listStyle === style.value;
            return (
              <button
                key={style.value}
                type="button"
                className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border transition-all text-center ${isActive ? "border-primary bg-primary/10 text-primary" : "border-border/50 hover:border-primary/40 hover:bg-muted/30 text-muted-foreground"}`}
                onClick={() => handleStyleChange(style.value)}
                data-testid={`style-${style.value}`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-semibold leading-tight">{style.label}</span>
                <span className="text-[8.5px] opacity-70 leading-tight">{style.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">
          {listStyle === "buttons" ? "Texto da mensagem" : "Titulo da lista"}
        </Label>
        <Input
          className="text-xs"
          placeholder={listStyle === "buttons" ? "Escolha uma opcao:" : "Como posso te ajudar?"}
          value={c.title || ""}
          onChange={(e) => onUpdateCfg(node.id, "title", e.target.value)}
          data-testid="input-lista-title"
        />
      </div>

      {listStyle === "list" && (
        <>
          <div>
            <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Texto do botao</Label>
            <Input
              className="text-xs"
              placeholder="Ver opcoes"
              maxLength={20}
              value={c.button_label || ""}
              onChange={(e) => onUpdateCfg(node.id, "button_label", e.target.value)}
              data-testid="input-lista-button"
            />
            <div className="text-[9px] text-muted-foreground mt-0.5">{(c.button_label || "").length}/20 caracteres</div>
          </div>
          <div>
            <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Rodape (opcional)</Label>
            <Input
              className="text-xs"
              placeholder="Escolha uma das opcoes abaixo"
              value={c.footer || ""}
              onChange={(e) => onUpdateCfg(node.id, "footer", e.target.value)}
              data-testid="input-lista-footer"
            />
          </div>
        </>
      )}

      {listStyle === "buttons" && (
        <div>
          <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Rodape (opcional)</Label>
          <Input
            className="text-xs"
            placeholder="Escolha uma das opcoes abaixo"
            value={c.footer || ""}
            onChange={(e) => onUpdateCfg(node.id, "footer", e.target.value)}
            data-testid="input-lista-footer"
          />
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-[10.5px] uppercase font-bold text-muted-foreground">Opcoes ({options.length}/{maxOptions})</Label>
          {options.length < maxOptions && (
            <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={addOption} data-testid="button-add-option">
              <Plus className="w-3 h-3 mr-0.5" /> Adicionar
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {options.map((opt, idx) => (
            <div key={opt.id} className="p-2 rounded-lg border bg-muted/20" data-testid={`option-item-${idx}`}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[9px] font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">{opt.id}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 ml-auto text-destructive"
                  onClick={() => removeOption(idx)}
                  data-testid={`button-remove-option-${idx}`}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
              <Input
                className="text-xs mb-1.5"
                placeholder={listStyle === "buttons" ? "Texto do botao" : "Titulo da opcao"}
                maxLength={listStyle === "buttons" ? 20 : 24}
                value={opt.label}
                onChange={(e) => updateOption(idx, "label", e.target.value)}
                data-testid={`input-option-label-${idx}`}
              />
              {listStyle !== "buttons" && (
                <Input
                  className="text-xs"
                  placeholder="Descricao (opcional)"
                  maxLength={72}
                  value={opt.description || ""}
                  onChange={(e) => updateOption(idx, "description", e.target.value)}
                  data-testid={`input-option-desc-${idx}`}
                />
              )}
              <div className="mt-1.5">
                <Label className="text-[9px] uppercase font-bold text-muted-foreground block mb-0.5">Direcionar p/ Pipeline</Label>
                <select
                  className="w-full bg-card border border-border rounded-lg py-1.5 px-2 text-[11px] text-foreground outline-none focus:border-primary"
                  value={opt.pipeline || ""}
                  onChange={(e) => updateOption(idx, "pipeline", e.target.value)}
                  data-testid={`select-option-pipeline-${idx}`}
                >
                  <option value="">Nenhuma (manter atual)</option>
                  {pipelines.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
          {options.length === 0 && (
            <div className="text-[11px] text-muted-foreground text-center py-3 border rounded-lg border-dashed">
              Nenhuma opcao adicionada
            </div>
          )}
        </div>
      </div>

      <div>
        <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Expirar apos (minutos)</Label>
        <Input
          className="text-xs"
          type="number"
          min={1}
          max={1440}
          value={c.timeout_minutes || 30}
          onChange={(e) => onUpdateCfg(node.id, "timeout_minutes", +e.target.value)}
          data-testid="input-lista-timeout"
        />
      </div>

      <div className="flex items-center justify-between p-2.5 rounded-lg border bg-muted/20">
        <div>
          <p className="text-[11px] font-medium text-foreground">Modo Opcional</p>
          <p className="text-[9.5px] text-muted-foreground leading-snug mt-0.5">
            Botoes aparecem como atalho, mas o usuario pode digitar livremente
          </p>
        </div>
        <Checkbox
          checked={c.blocking === false}
          onCheckedChange={(val) => onUpdateCfg(node.id, "blocking", !val)}
          data-testid="checkbox-optional-mode"
        />
      </div>

      <div className="text-[10px] text-muted-foreground p-2.5 bg-primary/5 rounded-lg leading-relaxed flex items-start gap-1.5 border border-primary/20">
        <Pause className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-primary" />
        <span>
          {c.blocking === false
            ? <>Este no <b>envia os botoes</b> como atalho e <b>continua o fluxo</b> sem pausar. O proximo no (ex: Resposta IA) captura qualquer resposta.</>
            : <>Este no <b>pausa o fluxo</b> ate o cliente escolher uma opcao. Conecte cada opcao a um no diferente clicando nas saidas do no no canvas.</>
          }
        </span>
      </div>
    </div>
  );
}
