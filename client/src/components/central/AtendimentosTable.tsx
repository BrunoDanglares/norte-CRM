import { useMemo, useState, type ReactNode } from "react";
import {
  type ColumnDef,
  type SortingState,
  type OnChangeFn,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDown, ArrowUp, ArrowUpDown,
  MessageSquare, Trash2,
  AlertTriangle, RotateCw,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { Lead } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { CanalIcon } from "@/components/brand-icons";
import { channelColor } from "@/components/inbox/helpers";

// API enriquece o lead com fotoUrl via JOIN com contacts (mesmo telefone+ws).
// Lead vem do shared/schema; aceitar opcional `fotoUrl` mantém retrocompat.
type LeadWithPhoto = Lead & { fotoUrl?: string | null };

type Props = {
  leads: LeadWithPhoto[];
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  onSelectLead: (lead: Lead) => void;
  onOpenChat: (lead: Lead) => void;
  onDelete: (lead: Lead) => void;
  emptyState: ReactNode;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** 'compact' = table-sm (linhas menores). 'comfortable' = table padrão. Default 'compact'. */
  density?: 'compact' | 'comfortable';
};

// Bruno 2026-07-04: data no formato do Nexus ("29 Mar 2024") — curto e legível.
function formatDate(v?: string | Date | null): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).replace(".", "");
}

// numeric do Postgres chega como string ("1500.00"). Formata em BRL; 0/vazio → "—".
function formatValor(v?: number | string | null): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (Number.isNaN(n) || n === 0) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

// Normaliza label do canal: "whatsapp" → "WhatsApp", "whatsapp_oficial" → "WhatsApp Oficial"
function formatCanal(canal: string | null | undefined): string {
  if (!canal) return "—";
  return canal
    .split(/[_\s-]+/)
    .map(w => w.length === 0 ? "" : (w.toLowerCase() === "whatsapp" ? "WhatsApp" : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

// Situação → badge daisyUI (soft). Cobre os 5 estágios universais + estados do
// backbone do bot. Limpa sufixo de hash de workspace que às vezes vaza no status
// (ex: "aguardando e6215875" → "Aguardando").
function statusBadge(status?: string | null): { cls: string; label: string } {
  let s = (status || "novo").toLowerCase().trim();
  // Remove o sufixo "_<hash-do-workspace>" (ex: "aguardando_e6215875" →
  // "aguardando"). Exige um dígito no token final pra NÃO comer palavras legítimas
  // como "atendimento_humano". Só depois normaliza _/- em espaço.
  s = s.replace(/_[a-z0-9]*\d[a-z0-9]*$/i, "").replace(/[_-]+/g, " ").trim();
  const map: Record<string, string> = {
    novo: "badge-info",
    lead: "badge-info",
    aguardando: "badge-neutral",
    "em automacao": "badge-warning",
    "em automação": "badge-warning",
    automacao: "badge-warning",
    "atendimento humano": "badge-primary",
    "em atendimento": "badge-primary",
    atendimento: "badge-primary",
    qualificado: "badge-primary",
    contato: "badge-primary",
    proposta: "badge-warning",
    negociacao: "badge-warning",
    negociação: "badge-warning",
    ganho: "badge-success",
    cliente: "badge-success",
    fechado: "badge-success",
    perdido: "badge-error",
  };
  const cls = map[s] || "badge-ghost";
  const label = s.replace(/^\w/, (c) => c.toUpperCase());
  return { cls, label };
}

// Avatar squircle (padrão Nexus: mask mask-squircle). Foto se houver; senão
// iniciais determinísticas sobre bg-base-200.
function pickInitials(name?: string | null, phone?: string | null): string {
  const cleaned = (name || "").trim().replace(/^[+\d\s\-()]+$/, "").trim();
  if (!cleaned) {
    const digits = (phone || name || "").replace(/\D/g, "");
    return digits.slice(-2) || "??";
  }
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function SquircleAvatar({ name, phone, fotoUrl, size }: { name?: string | null; phone?: string | null; fotoUrl?: string | null; size: number }) {
  const [errored, setErrored] = useState(false);
  const showPhoto = fotoUrl && !errored;
  if (showPhoto) {
    return (
      <img
        src={fotoUrl!}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setErrored(true)}
        className="mask mask-squircle bg-base-200 object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="mask mask-squircle bg-primary/10 text-primary grid place-items-center shrink-0 font-bold"
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.38)) }}
      aria-hidden="true"
    >
      {pickInitials(name, phone)}
    </span>
  );
}

export function AtendimentosTable({
  leads,
  sorting,
  onSortingChange,
  onSelectLead,
  onOpenChat,
  onDelete,
  emptyState,
  isLoading = false,
  error = null,
  onRetry,
  density = 'compact',
}: Props) {
  const isCompact = density === 'compact';
  const avatarSize = isCompact ? 36 : 40;
  // Seleção de linhas (estilo data-table do Nexus). Local à tabela.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const allSelected = leads.length > 0 && selected.size === leads.length;
  const someSelected = selected.size > 0 && selected.size < leads.length;

  const columns = useMemo<ColumnDef<LeadWithPhoto>[]>(
    () => [
      {
        id: "select",
        header: () => (
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            aria-label="Selecionar todos"
            checked={allSelected}
            ref={(el) => { if (el) el.indeterminate = someSelected; }}
            onChange={(e) => setSelected(e.target.checked ? new Set(leads.map((l) => l.id as number)) : new Set())}
          />
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const id = row.original.id as number;
          return (
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              aria-label="Selecionar linha"
              checked={selected.has(id)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; })}
              data-testid={`checkbox-lead-${id}`}
            />
          );
        },
      },
      {
        id: "id",
        header: "#",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-base-content/70 font-medium tabular-nums">{row.index + 1}</span>
        ),
      },
      {
        id: "nome",
        accessorKey: "nome",
        header: "Contato",
        enableSorting: true,
        cell: ({ row }) => {
          const lead = row.original;
          const tel = lead.telefone || lead.contato || "";
          return (
            <div className="flex items-center gap-3 truncate">
              <SquircleAvatar name={lead.nome} phone={tel} fotoUrl={lead.fotoUrl ?? null} size={avatarSize} />
              <div className="min-w-0">
                <p className="font-medium text-base-content truncate leading-tight">{lead.nome || "Sem nome"}</p>
                <p className="text-base-content/60 text-xs tabular-nums truncate leading-tight mt-0.5">{tel || "—"}</p>
              </div>
            </div>
          );
        },
      },
      {
        id: "email",
        header: "Email",
        enableSorting: false,
        cell: ({ row }) => {
          const email = row.original.email;
          return email
            ? <span className="text-sm text-base-content/80">{email}</span>
            : <span className="text-base-content/35">—</span>;
        },
      },
      {
        id: "canal",
        header: "Canal",
        enableSorting: false,
        cell: ({ row }) => {
          const lead = row.original;
          const color = channelColor(lead.canal || "");
          return (
            <span
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-field text-xs font-medium border"
              style={{
                color,
                background: `color-mix(in oklch, ${color} 10%, transparent)`,
                borderColor: `color-mix(in oklch, ${color} 25%, transparent)`,
              }}
              title={lead.canal || ""}
            >
              <CanalIcon canal={lead.canal || ""} className="w-3 h-3 shrink-0" />
              {formatCanal(lead.canal)}
            </span>
          );
        },
      },
      {
        id: "status",
        header: "Situação",
        enableSorting: false,
        cell: ({ row }) => {
          const { cls, label } = statusBadge(row.original.status);
          return <span className={`badge badge-sm badge-soft ${cls} font-medium`}>{label}</span>;
        },
      },
      {
        id: "valor",
        header: "Valor",
        enableSorting: false,
        cell: ({ row }) => {
          const v = formatValor(row.original.valor as any);
          return v === "—"
            ? <span className="text-base-content/35">—</span>
            : <span className="text-sm font-medium text-base-content tabular-nums">{v}</span>;
        },
      },
      {
        id: "data",
        header: "Cadastro",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm text-base-content/70 tabular-nums whitespace-nowrap">{formatDate(row.original.createdAt)}</span>
        ),
      },
      {
        id: "acoes",
        header: "",
        enableSorting: false,
        cell: ({ row }) => {
          const lead = row.original;
          return (
            <div className="inline-flex w-fit gap-0.5">
              <button
                type="button"
                className="btn btn-square btn-ghost btn-sm"
                onClick={(e) => { e.stopPropagation(); onOpenChat(lead); }}
                title="Abrir chat"
                aria-label={`Abrir chat com ${lead.nome}`}
                data-testid={`button-inbox-lead-${lead.id}`}
              >
                <MessageSquare className="w-4 h-4 text-base-content/70" />
              </button>
              <button
                type="button"
                className="btn btn-square btn-ghost btn-sm hover:text-error"
                onClick={(e) => { e.stopPropagation(); onDelete(lead); }}
                title="Excluir contato"
                aria-label={`Excluir ${lead.nome}`}
                data-testid={`button-delete-lead-${lead.id}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          );
        },
      },
    ],
    [onOpenChat, onDelete, selected, allSelected, someSelected, leads, avatarSize],
  );

  const table = useReactTable({
    data: leads,
    columns,
    state: { sorting },
    onSortingChange,
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
  });

  const rows = table.getRowModel().rows;
  const prefersReducedMotion = useReducedMotion();

  return (
    <table className={`table ${isCompact ? "table-sm" : ""} w-full`}>
      <thead className="sticky top-0 z-10 [&_th]:bg-base-100/95 [&_th]:backdrop-blur-md">
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => {
              const canSort = header.column.getCanSort();
              const sortDir = header.column.getIsSorted();
              return (
                <th
                  key={header.id}
                  className={canSort ? "cursor-pointer select-none hover:text-base-content transition-colors" : ""}
                  onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                  aria-sort={sortDir === "asc" ? "ascending" : sortDir === "desc" ? "descending" : "none"}
                  data-testid={`th-${header.column.id}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {canSort && (
                      sortDir === "asc" ? <ArrowUp className="w-3 h-3 opacity-70" />
                      : sortDir === "desc" ? <ArrowDown className="w-3 h-3 opacity-70" />
                      : <ArrowUpDown className="w-3 h-3 opacity-40" />
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        ))}
      </thead>
      <tbody>
        {error ? (
          <tr>
            <td colSpan={columns.length}>
              <div className="flex flex-col items-center justify-center gap-3 py-14 px-6 text-center">
                <div className="w-10 h-10 rounded-full bg-error/10 text-error flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-base-content">Não foi possível carregar os contatos</div>
                  <div className="text-xs text-base-content/60 mt-1 max-w-md">{error}</div>
                </div>
                {onRetry && (
                  <Button variant="outline" size="sm" onClick={onRetry} data-testid="button-table-retry">
                    <RotateCw className="w-3.5 h-3.5" />
                    Tentar de novo
                  </Button>
                )}
              </div>
            </td>
          </tr>
        ) : isLoading && rows.length === 0 ? (
          Array.from({ length: 6 }).map((_, i) => (
            <tr key={`sk-${i}`}>
              <td><Skeleton className="h-4 w-4 rounded" /></td>
              <td><Skeleton className="h-3 w-4" /></td>
              <td>
                <div className="flex items-center gap-3">
                  <Skeleton className="h-9 w-9 rounded-box" />
                  <div className="flex-1">
                    <Skeleton className="h-3.5 w-40 mb-1.5" />
                    <Skeleton className="h-2.5 w-28" />
                  </div>
                </div>
              </td>
              <td><Skeleton className="h-3 w-32" /></td>
              <td><Skeleton className="h-6 w-20 rounded-field" /></td>
              <td><Skeleton className="h-5 w-16 rounded-field" /></td>
              <td><Skeleton className="h-3 w-14" /></td>
              <td><Skeleton className="h-3 w-20" /></td>
              <td><div className="flex gap-1"><Skeleton className="w-8 h-8 rounded-box" /><Skeleton className="w-8 h-8 rounded-box" /></div></td>
            </tr>
          ))
        ) : rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length}>{emptyState}</td>
          </tr>
        ) : (
          rows.map((row) => {
            const lead = row.original;
            return (
              <motion.tr
                key={row.id}
                className="group/row hover:bg-base-200/40 cursor-pointer *:text-nowrap"
                onClick={() => onSelectLead(lead)}
                data-testid={`row-lead-${lead.id}`}
                initial={prefersReducedMotion ? false : { opacity: 0, y: 4 }}
                animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
                transition={prefersReducedMotion ? undefined : { duration: 0.18 }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </motion.tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}
