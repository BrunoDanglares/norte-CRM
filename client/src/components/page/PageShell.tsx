// Componentes do design system "Banana Trail" — padrão visual unificado
// da Central de Atendimentos aplicado em todas as páginas do app.
//
// Tokens-chave:
//   --brand-brown      → underline da aba ativa + número de protocolo
//   --brand-brown-tint → ring/border de inputs em focus
//   --banana-50        → gradient de fundo da aba ativa + hover de linhas
//   --banana-300       → bg sólido da pill ativa de período
//   --ink-on-banana    → texto preto fixo sobre fundo banana
//
// Bruno 2026-05-15: criado a partir da Central de Atendimentos. Refatorada
// pra usar PageHeader/PageTabs/FilterBar e servir como referência viva.

import { ReactNode } from "react";
import { Search } from "lucide-react";

// ── PageShell ─────────────────────────────────────────────────────────────
// Container externo. Padding 24px, overflow vertical, altura total.
// Usar como root da página (substitui `<div className="h-full flex flex-col">`).

interface PageShellProps {
  children: ReactNode;
  className?: string;
  /** Quando true, NÃO aplica padding (página controla — útil pra inbox/leads
   *  que têm layout edge-to-edge). */
  edgeToEdge?: boolean;
}

export function PageShell({ children, className = "", edgeToEdge = false }: PageShellProps) {
  return (
    <div
      className={`h-full overflow-y-auto bg-background ${edgeToEdge ? "" : "p-6"} ${className}`}
      data-testid="page-shell"
    >
      {children}
    </div>
  );
}

// ── PageHeader ────────────────────────────────────────────────────────────
// Título h1 22px + subtítulo muted + slot opcional de ações à direita.
// Tipografia automática via global rule de h1 (Inter Tight + tracking).

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Espaçamento abaixo. Default mb-5; passe mb-0 quando seguido de tabs. */
  className?: string;
}

export function PageHeader({ title, subtitle, actions, className = "" }: PageHeaderProps) {
  return (
    <div className={className} data-testid="page-header">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold tracking-tight leading-tight text-foreground">{title}</h1>
          {subtitle && (
            <p className="text-[13px] text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
      </div>
      {/* Bruno 2026-06-11: removida a faixa de identidade ("beiral") que ficava
          logo abaixo do header — pedido pra tirar de todas as telas do CRM. */}
    </div>
  );
}

// ── PageTabs ──────────────────────────────────────────────────────────────
// Tabs underline marrom + gradient banana-50 na ativa. Padrão "Central de
// Atendimentos" — replica da history-tabs CSS via Tailwind tokens.

interface PageTab {
  key: string;
  label: string;
  count?: number;
  icon?: ReactNode;
}

interface PageTabsProps {
  tabs: PageTab[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}

export function PageTabs({ tabs, active, onChange, className = "" }: PageTabsProps) {
  // Redesign Norte: pílula seg-tab (ativa = azul sólido bg-primary), igual ao
  // resto do CRM. Antes: underline marrom-logo + gradient banana (resíduo
  // ChatBanana). A classe .seg-tab vive em styles/nexus.css.
  return (
    <div
      className={`inline-flex flex-wrap gap-1 ${className}`}
      role="tablist"
      data-testid="page-tabs"
    >
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={`seg-tab active:scale-[0.97] ${isActive ? "seg-tab-active" : ""}`}
            data-testid={`page-tab-${tab.key}`}
          >
            {tab.icon}
            {tab.label}
            {typeof tab.count === "number" && (
              <span
                className={`text-[10.5px] font-bold tabular-nums px-1.5 py-0.5 rounded-full min-w-[20px] text-center ${
                  isActive ? "bg-primary-content/20 text-primary-content" : "bg-base-200 text-base-content/60"
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── FilterBar ─────────────────────────────────────────────────────────────
// Container flex pra search + selects + toggles. Itens devem ser
// FilterSearch / FilterSelect / outros componentes utilitários.

interface FilterBarProps {
  children: ReactNode;
  className?: string;
}

export function FilterBar({ children, className = "" }: FilterBarProps) {
  return (
    <div className={`flex flex-wrap items-center gap-2.5 ${className}`} data-testid="filter-bar">
      {children}
    </div>
  );
}

// ── FilterSearch ──────────────────────────────────────────────────────────
// Input de busca com ícone à esquerda. Focus em brand-brown + ring tint.

interface FilterSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Largura mínima/máxima — default flex-1 min-w-[200px] max-w-[320px]. */
  className?: string;
  testid?: string;
}

export function FilterSearch({
  value,
  onChange,
  placeholder = "Buscar...",
  className = "flex-1 min-w-[200px] max-w-[320px]",
  testid = "filter-search",
}: FilterSearchProps) {
  return (
    <div className={`relative ${className}`}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-muted-foreground pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-card text-[13px] text-foreground placeholder:text-muted-foreground transition-[border-color,box-shadow] duration-150 focus:outline-none focus-banana-ring"
        data-testid={testid}
      />
    </div>
  );
}

// ── FilterSelect ──────────────────────────────────────────────────────────
// Select nativo estilizado com mesmo tratamento de focus.

interface FilterSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
  testid?: string;
}

export function FilterSelect({
  value,
  onChange,
  options,
  className = "min-w-[140px]",
  testid = "filter-select",
}: FilterSelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-9 px-3 rounded-md border border-border bg-card text-[13px] text-foreground cursor-pointer transition-[border-color,box-shadow] duration-150 hover:border-[var(--brand-brown-tint)] focus:outline-none focus-banana-ring ${className}`}
      data-testid={testid}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
