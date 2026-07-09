import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight } from "lucide-react";
import { NODE_TYPES, NODE_CATEGORIES, type FlowNode } from "./types";

export function SidebarPalette() {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ basicos: true, avancados: true, integracoes: true });
  const toggle = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  return (
    <div className="w-[160px] flex-shrink-0 bg-card border-r overflow-y-auto p-2.5">
      <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Arrastar p/ canvas</div>
      {NODE_CATEGORIES.map(cat => {
        const visibleTypes = cat.types;
        if (visibleTypes.length === 0) return null;
        const isOpen = !collapsed[cat.key];
        return (
          <div key={cat.key} className="mb-1">
            <button
              className="flex items-center gap-1 w-full px-1.5 py-1 rounded-md text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/40 transition-colors"
              onClick={() => toggle(cat.key)}
              data-testid={`palette-cat-${cat.key}`}
            >
              {isOpen ? <ChevronDown className="w-3 h-3 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 flex-shrink-0" />}
              <span>{cat.label}</span>
              <span className="ml-auto text-[8px] font-normal opacity-60">{visibleTypes.length}</span>
            </button>
            {isOpen && (
              <div className="mt-0.5">
                {visibleTypes.map(type => {
                  const conf = NODE_TYPES[type];
                  if (!conf) return null;
                  const Icon = conf.icon;
                  return (
                    <div
                      key={type}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("nodeType", type)}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg mb-1 border bg-muted/20 cursor-grab text-[11px] transition-all hover:border-primary/40"
                    >
                      <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: conf.color }} />
                      <span className="leading-tight truncate">{conf.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function CategorizedPickerPopup({ onSelect, onClose, fixed, posX, posY, title, excludeTypes }: {
  onSelect: (type: string) => void;
  onClose: () => void;
  fixed?: boolean;
  posX?: number;
  posY?: number;
  title?: string;
  excludeTypes?: string[];
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  const excluded = new Set([...(excludeTypes || []), "trigger"]);
  return (
    <div
      className={`${fixed ? "fixed" : "absolute top-[50px] left-[16px]"} z-[100] bg-card border-2 border-border rounded-xl p-3.5 shadow-2xl`}
      style={{ width: 360, ...(fixed ? { left: posX, top: posY } : {}) }}
      onClick={(e) => e.stopPropagation()}
      data-testid="categorized-picker"
    >
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{title || "Tipo de no"}</div>
      {NODE_CATEGORIES.map(cat => {
        const items = cat.types.filter(t => !excluded.has(t));
        if (items.length === 0) return null;
        const isOpen = !collapsed[cat.key];
        return (
          <div key={cat.key} className="mb-1.5">
            <button
              className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/40 transition-colors"
              onClick={() => toggle(cat.key)}
              data-testid={`picker-cat-${cat.key}`}
            >
              {isOpen ? <ChevronDown className="w-3 h-3 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 flex-shrink-0" />}
              <span>{cat.label}</span>
              <span className="ml-auto text-[8px] font-normal opacity-60">{items.length}</span>
            </button>
            {isOpen && (
              <div className="grid grid-cols-2 gap-1.5 mt-1 pl-1">
                {items.map(type => {
                  const conf = NODE_TYPES[type];
                  if (!conf) return null;
                  const Icon = conf.icon;
                  return (
                    <div
                      key={type}
                      className="p-2 rounded-lg border cursor-pointer flex items-center gap-2 transition-all hover:border-primary/50"
                      style={{ borderColor: "hsl(var(--border))" }}
                      onClick={() => onSelect(type)}
                      data-testid={`picker-node-${type}`}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" style={{ color: conf.color }} />
                      <span className="text-[11px] font-semibold truncate">{conf.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <Button variant="outline" size="sm" className="w-full justify-center mt-1" onClick={onClose}>Fechar</Button>
    </div>
  );
}

export function CategorizedInlineList({ excludeTypes, onSelect, testIdPrefix }: {
  excludeTypes?: string[];
  onSelect: (type: string) => void;
  testIdPrefix?: string;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  const excluded = new Set(excludeTypes || []);
  return (
    <>
      {NODE_CATEGORIES.map(cat => {
        const items = cat.types.filter(t => !excluded.has(t));
        if (items.length === 0) return null;
        const isOpen = !collapsed[cat.key];
        return (
          <div key={cat.key}>
            <button
              className="flex items-center gap-1 w-full px-2 py-1 text-[8.5px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/30 transition-colors rounded"
              onClick={(e) => { e.stopPropagation(); toggle(cat.key); }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {isOpen ? <ChevronDown className="w-2.5 h-2.5 flex-shrink-0" /> : <ChevronRight className="w-2.5 h-2.5 flex-shrink-0" />}
              <span>{cat.label}</span>
            </button>
            {isOpen && items.map(type => {
              const conf = NODE_TYPES[type];
              if (!conf) return null;
              const TIcon = conf.icon;
              return (
                <div
                  key={type}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => onSelect(type)}
                  data-testid={testIdPrefix ? `${testIdPrefix}-${type}` : undefined}
                >
                  <TIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: conf.color }} />
                  <span className="text-[10.5px] font-semibold">{conf.label}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

