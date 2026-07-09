// Drawer lateral direito com a ficha completa do contato/lead.
// Bruno 2026-05-19: substitui LeadProfileDialog (popover) + modal "Editar
// completo" inline. Layout horizontal (imagem 1 referência): header com
// avatar + nome + canal + data; campos em colunas; auto-save por campo
// (blur OU debounce 600ms). Mesmo componente atende /contatos, /leads e o
// painel de ações do /inbox.

import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import ContactAvatar from "@/components/ContactAvatar";
import {
  Phone,
  Mail,
  Building,
  User as UserIcon,
  Calendar,
  MapPin,
  MessageSquare,
  Hash,
  X,
  Loader2,
  Check,
  Tag as TagIcon,
} from "lucide-react";
import { WhatsAppIcon, InstagramIcon } from "@/components/brand-icons";
import type { Contact, Lead, LeadTag } from "@shared/schema";

type ProfileEntity = (Contact | Lead) & {
  // Lead-only fields são opcionais aqui
  contato?: string | null;
  valor?: number | null;
  status?: string | null;
  owner?: string | null;
  pipeline?: string | null;
  prioridade?: string | null;
};

type EntityKind = "contact" | "lead";

interface ContactProfilePanelProps {
  open: boolean;
  onClose: () => void;
  entity: ProfileEntity | null;
  entityKind: EntityKind;
  onOpenConversation?: (entity: ProfileEntity) => void;
  availableTags?: LeadTag[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getChannelIcon(canal: string | null | undefined) {
  const c = (canal || "").toLowerCase();
  if (c.includes("whatsapp")) return <WhatsAppIcon className="w-3.5 h-3.5" />;
  if (c.includes("instagram")) return <InstagramIcon className="w-3.5 h-3.5" />;
  return <MessageSquare className="w-3.5 h-3.5" />;
}

function getChannelLabel(canal: string | null | undefined): string {
  const c = (canal || "").toLowerCase();
  if (c.includes("whatsapp oficial")) return "WhatsApp Oficial";
  if (c.includes("whatsapp")) return "WhatsApp";
  if (c.includes("instagram")) return "Instagram";
  if (c === "web chat" || c === "webchat") return "Web chat";
  return canal || "—";
}

function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  // BR: 55 + DDD + número
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith("55")) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return phone;
}

function formatCreatedAt(date: string | Date | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR");
}

// ── Form state ─────────────────────────────────────────────────────────────

interface FormState {
  nome: string;
  cpf: string;
  email: string;
  empresa: string;
  dataNascimento: string;
  notas: string;
  enderecoRua: string;
  enderecoNumero: string;
  enderecoBairro: string;
  enderecoCidade: string;
  enderecoUf: string;
  enderecoCep: string;
  tags: string[];
}

function entityToForm(entity: ProfileEntity | null): FormState {
  return {
    nome: entity?.nome || "",
    cpf: (entity as any)?.cpf || "",
    email: entity?.email || "",
    empresa: entity?.empresa || "",
    dataNascimento: (entity as any)?.dataNascimento || "",
    notas: (entity as any)?.notas || "",
    enderecoRua: (entity as any)?.enderecoRua || "",
    enderecoNumero: (entity as any)?.enderecoNumero || "",
    enderecoBairro: (entity as any)?.enderecoBairro || "",
    enderecoCidade: (entity as any)?.enderecoCidade || "",
    enderecoUf: (entity as any)?.enderecoUf || "",
    enderecoCep: (entity as any)?.enderecoCep || "",
    tags: entity?.tags || [],
  };
}

// ── Auto-save por campo (debounce 600ms ou blur imediato) ──────────────────
//
// Estratégia: cada onChange agenda um save com debounce; cada onBlur cancela
// o debounce e dispara save imediato. Evita PATCH a cada tecla mas garante
// persistência mesmo se o user sair do campo antes do debounce vencer.

const AUTOSAVE_DEBOUNCE_MS = 600;

// ── Componente principal ───────────────────────────────────────────────────

export default function ContactProfilePanel({
  open,
  onClose,
  entity,
  entityKind,
  onOpenConversation,
  availableTags,
}: ContactProfilePanelProps) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(() => entityToForm(entity));
  const [savingFields, setSavingFields] = useState<Set<keyof FormState>>(new Set());
  const [savedFields, setSavedFields] = useState<Set<keyof FormState>>(new Set());
  const debounceTimers = useRef<Map<keyof FormState, ReturnType<typeof setTimeout>>>(new Map());

  // Reset form quando entity muda (abrir outro contato)
  useEffect(() => {
    setForm(entityToForm(entity));
    setSavingFields(new Set());
    setSavedFields(new Set());
    // Limpa timers pendentes
    debounceTimers.current.forEach((t) => clearTimeout(t));
    debounceTimers.current.clear();
  }, [entity?.id]);

  // Patch real
  const patchField = useCallback(
    async (field: keyof FormState, value: any) => {
      if (!entity?.id) return;
      const endpoint = entityKind === "lead" ? `/api/leads/${entity.id}` : `/api/contacts/${entity.id}`;
      setSavingFields((prev) => new Set(prev).add(field));
      try {
        await apiRequest("PATCH", endpoint, { [field]: value });
        // Mostra check verde por 1.2s pra dar feedback
        setSavedFields((prev) => new Set(prev).add(field));
        setTimeout(() => {
          setSavedFields((prev) => {
            const next = new Set(prev);
            next.delete(field);
            return next;
          });
        }, 1200);
        // Invalida queries afetadas
        queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      } catch (err: any) {
        toast({
          title: "Erro ao salvar",
          description: err?.message || String(err),
          variant: "destructive",
        });
      } finally {
        setSavingFields((prev) => {
          const next = new Set(prev);
          next.delete(field);
          return next;
        });
      }
    },
    [entity?.id, entityKind, toast],
  );

  // Onchange agenda debounce
  const onChangeField = useCallback(
    (field: keyof FormState, value: any) => {
      setForm((prev) => ({ ...prev, [field]: value }));
      const prevTimer = debounceTimers.current.get(field);
      if (prevTimer) clearTimeout(prevTimer);
      const timer = setTimeout(() => {
        patchField(field, value);
        debounceTimers.current.delete(field);
      }, AUTOSAVE_DEBOUNCE_MS);
      debounceTimers.current.set(field, timer);
    },
    [patchField],
  );

  // Onblur dispara imediato (cancela debounce)
  const onBlurField = useCallback(
    (field: keyof FormState) => {
      const timer = debounceTimers.current.get(field);
      if (timer) {
        clearTimeout(timer);
        debounceTimers.current.delete(field);
        patchField(field, form[field]);
      }
    },
    [form, patchField],
  );

  // Tags — toggle (não usa debounce, salva direto)
  const onToggleTag = useCallback(
    (tagName: string) => {
      if (!entity?.id) return;
      const has = form.tags.includes(tagName);
      const nextTags = has ? form.tags.filter((t) => t !== tagName) : [...form.tags, tagName];
      setForm((prev) => ({ ...prev, tags: nextTags }));
      patchField("tags", nextTags);
    },
    [entity?.id, form.tags, patchField],
  );

  if (!entity) return null;

  const channelLabel = getChannelLabel(entity.canal);
  const telefoneDisplay = formatPhoneDisplay(entity.telefone);
  const createdAtDisplay = formatCreatedAt(entity.createdAt as any);
  const initials = (entity.nome || "?").trim().slice(0, 2).toUpperCase();

  // Bruno 2026-05-21: Radix Dialog primitivo direto (não usa Sheet do shadcn
  // que tem z-50 hardcoded). ContactProfilePanel é aberto dentro do
  // ConversaDrawer (vaul, z-[70]); com z-50, o overlay e o content ficavam
  // atrás do drawer pai e usuário só via "lado esquerdo escuro".
  // Aqui controlamos z-index manualmente: overlay z-[89], content z-[90].
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          style={{ zIndex: 89 }}
        />
        <DialogPrimitive.Content
          className="fixed inset-y-0 right-0 h-full w-full sm:max-w-[640px] bg-card text-card-foreground border-l shadow-lg overflow-y-auto data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right data-[state=closed]:duration-300 data-[state=open]:duration-500"
          style={{ zIndex: 90 }}
          data-testid="contact-profile-panel"
        >
          <DialogPrimitive.Title className="sr-only">Ficha do contato</DialogPrimitive.Title>
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur px-6 py-4 flex items-center gap-4">
          <ContactAvatar
            nome={entity.nome || "?"}
            fotoUrl={(entity as any).fotoUrl || undefined}
            size={48}
          />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[15px] truncate" data-testid="profile-name">{entity.nome || "—"}</div>
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground mt-0.5">
              {getChannelIcon(entity.canal)}
              <span className="truncate">{telefoneDisplay || entity.telefone || "Sem telefone"}</span>
            </div>
          </div>
          {createdAtDisplay && (
            <div className="text-[11.5px] text-muted-foreground whitespace-nowrap" data-testid="profile-created-at">
              {createdAtDisplay}
            </div>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-close-profile"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div className="p-6 space-y-5">
          {/* Linha 1: Nome | Documento | Tipo */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_160px] gap-4">
            <FieldInput
              label="Nome"
              value={form.nome}
              onChange={(v) => onChangeField("nome", v)}
              onBlur={() => onBlurField("nome")}
              saving={savingFields.has("nome")}
              saved={savedFields.has("nome")}
              testid="input-profile-nome"
            />
            <FieldInput
              label="Documento"
              value={form.cpf}
              onChange={(v) => onChangeField("cpf", v)}
              onBlur={() => onBlurField("cpf")}
              saving={savingFields.has("cpf")}
              saved={savedFields.has("cpf")}
              placeholder="CPF ou CNPJ"
              testid="input-profile-cpf"
            />
            <div className="space-y-1.5">
              <label className="text-[11px] text-muted-foreground font-medium">Tipo</label>
              <div className="flex items-center gap-2 h-[40px] px-3 rounded-md bg-secondary/50 border border-border text-[13px]" data-testid="profile-channel-display">
                <span className="text-primary">{getChannelIcon(entity.canal)}</span>
                <span className="truncate">{channelLabel}</span>
              </div>
            </div>
          </div>

          {/* Identificador no canal (readonly + helper) */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-muted-foreground font-medium">Identificador no canal</label>
            <input
              value={entity.telefone || ""}
              readOnly
              disabled
              className="w-full h-[40px] px-3 rounded-md bg-secondary/30 border border-border text-[13px] text-muted-foreground cursor-not-allowed"
              data-testid="profile-channel-identifier"
            />
            <p className="text-[10.5px] text-muted-foreground/70">A edição do identificador deste canal não está disponível aqui.</p>
          </div>

          {/* Linha 2: Email | Empresa */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldInput
              label="E-mail"
              type="email"
              value={form.email}
              onChange={(v) => onChangeField("email", v)}
              onBlur={() => onBlurField("email")}
              saving={savingFields.has("email")}
              saved={savedFields.has("email")}
              placeholder="email@exemplo.com"
              testid="input-profile-email"
            />
            <FieldInput
              label="Empresa"
              value={form.empresa}
              onChange={(v) => onChangeField("empresa", v)}
              onBlur={() => onBlurField("empresa")}
              saving={savingFields.has("empresa")}
              saved={savedFields.has("empresa")}
              testid="input-profile-empresa"
            />
          </div>

          {/* Linha 3: Data de nascimento (em 1 coluna estreita) */}
          <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4">
            <FieldInput
              label="Nascimento"
              type="date"
              value={form.dataNascimento}
              onChange={(v) => onChangeField("dataNascimento", v)}
              onBlur={() => onBlurField("dataNascimento")}
              saving={savingFields.has("dataNascimento")}
              saved={savedFields.has("dataNascimento")}
              testid="input-profile-nascimento"
            />
            <div />
          </div>

          {/* Anotações */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-muted-foreground font-medium">Anotações</label>
              <SavingIndicator saving={savingFields.has("notas")} saved={savedFields.has("notas")} />
            </div>
            <textarea
              value={form.notas}
              onChange={(e) => onChangeField("notas", e.target.value)}
              onBlur={() => onBlurField("notas")}
              rows={5}
              className="w-full px-3 py-2.5 rounded-md bg-background border border-border focus:border-primary focus:ring-1 focus:ring-primary/30 focus:outline-none text-[13px] resize-y min-h-[110px]"
              placeholder="Anotações livres sobre o contato, preferências, contexto..."
              data-testid="textarea-profile-notas"
            />
          </div>

          {/* Tags */}
          {availableTags && availableTags.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <TagIcon className="w-3.5 h-3.5 text-muted-foreground" />
                <label className="text-[11px] text-muted-foreground font-medium">Tags</label>
                <SavingIndicator saving={savingFields.has("tags")} saved={savedFields.has("tags")} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {availableTags.map((tag) => {
                  const active = form.tags.includes(tag.nome);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => onToggleTag(tag.nome)}
                      className={`text-[11px] px-2.5 py-1 rounded-full border transition-all ${
                        active
                          ? "border-transparent text-white font-medium"
                          : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                      }`}
                      style={active ? { background: tag.cor || "hsl(var(--primary))" } : undefined}
                      data-testid={`tag-toggle-${tag.nome.toLowerCase()}`}
                    >
                      {tag.nome}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Endereço */}
          <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-3">
            <div className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground font-bold uppercase tracking-wide">Endereço</span>
            </div>
            <div className="grid grid-cols-[1fr_100px] gap-3">
              <FieldInput
                label="Rua"
                value={form.enderecoRua}
                onChange={(v) => onChangeField("enderecoRua", v)}
                onBlur={() => onBlurField("enderecoRua")}
                saving={savingFields.has("enderecoRua")}
                saved={savedFields.has("enderecoRua")}
                testid="input-profile-rua"
              />
              <FieldInput
                label="Número"
                value={form.enderecoNumero}
                onChange={(v) => onChangeField("enderecoNumero", v)}
                onBlur={() => onBlurField("enderecoNumero")}
                saving={savingFields.has("enderecoNumero")}
                saved={savedFields.has("enderecoNumero")}
                testid="input-profile-numero"
              />
            </div>
            <FieldInput
              label="Bairro"
              value={form.enderecoBairro}
              onChange={(v) => onChangeField("enderecoBairro", v)}
              onBlur={() => onBlurField("enderecoBairro")}
              saving={savingFields.has("enderecoBairro")}
              saved={savedFields.has("enderecoBairro")}
              testid="input-profile-bairro"
            />
            <div className="grid grid-cols-[1fr_60px_110px] gap-3">
              <FieldInput
                label="Cidade"
                value={form.enderecoCidade}
                onChange={(v) => onChangeField("enderecoCidade", v)}
                onBlur={() => onBlurField("enderecoCidade")}
                saving={savingFields.has("enderecoCidade")}
                saved={savedFields.has("enderecoCidade")}
                testid="input-profile-cidade"
              />
              <FieldInput
                label="UF"
                value={form.enderecoUf}
                onChange={(v) => onChangeField("enderecoUf", v.toUpperCase().slice(0, 2))}
                onBlur={() => onBlurField("enderecoUf")}
                saving={savingFields.has("enderecoUf")}
                saved={savedFields.has("enderecoUf")}
                maxLength={2}
                placeholder="AM"
                testid="input-profile-uf"
              />
              <FieldInput
                label="CEP"
                value={form.enderecoCep}
                onChange={(v) => onChangeField("enderecoCep", v)}
                onBlur={() => onBlurField("enderecoCep")}
                saving={savingFields.has("enderecoCep")}
                saved={savedFields.has("enderecoCep")}
                placeholder="00000-000"
                testid="input-profile-cep"
              />
            </div>
          </div>

          {/* Ação: abrir conversa (no rodapé do drawer) */}
          {onOpenConversation && (
            <div className="pt-2">
              <Button
                variant="outline"
                onClick={() => onOpenConversation(entity)}
                className="w-full h-10 text-[13px]"
                data-testid="button-profile-open-conversation"
              >
                <MessageSquare className="w-4 h-4 mr-2" /> Abrir Conversa
              </Button>
            </div>
          )}
        </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ── Subcomponentes ─────────────────────────────────────────────────────────

interface FieldInputProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  saving?: boolean;
  saved?: boolean;
  type?: string;
  placeholder?: string;
  maxLength?: number;
  testid?: string;
}

function FieldInput({
  label,
  value,
  onChange,
  onBlur,
  saving,
  saved,
  type = "text",
  placeholder,
  maxLength,
  testid,
}: FieldInputProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[11px] text-muted-foreground font-medium">{label}</label>
        <SavingIndicator saving={saving} saved={saved} />
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        maxLength={maxLength}
        className="w-full h-[40px] px-3 rounded-md bg-background border border-border focus:border-primary focus:ring-1 focus:ring-primary/30 focus:outline-none text-[13px]"
        data-testid={testid}
      />
    </div>
  );
}

function SavingIndicator({ saving, saved }: { saving?: boolean; saved?: boolean }) {
  if (saving) {
    return (
      <span className="flex items-center gap-1 text-[9.5px] text-muted-foreground">
        <Loader2 className="w-2.5 h-2.5 animate-spin" /> salvando…
      </span>
    );
  }
  if (saved) {
    return (
      <span className="flex items-center gap-1 text-[9.5px] text-emerald-500">
        <Check className="w-2.5 h-2.5" /> salvo
      </span>
    );
  }
  return null;
}
