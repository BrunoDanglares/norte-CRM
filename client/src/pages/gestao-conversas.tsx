import { useState, lazy, Suspense } from "react";
import { useLocation } from "wouter";
import { MessagesSquare, Zap, Megaphone, Calendar, Loader2 } from "lucide-react";

const RespostasRapidas = lazy(() => import("./respostas-rapidas"));
const Campanhas = lazy(() => import("./campanhas"));
const DisparosProgramados = lazy(() => import("./disparos-programados"));

type TabKey = "respostas" | "campanhas" | "disparos";

export default function GestaoConversas() {
  const [location] = useLocation();

  const tabs: { key: TabKey; label: string; icon: any }[] = [
    { key: "respostas", label: "Respostas Rápidas", icon: Zap },
    { key: "disparos", label: "Disparo Programado", icon: Calendar },
    { key: "campanhas", label: "Campanhas em Massa", icon: Megaphone },
  ];

  const initialTab: TabKey = location.includes("tab=campanhas")
    ? "campanhas"
    : location.includes("tab=disparos")
    ? "disparos"
    : "respostas";
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  return (
    <div className="h-full flex flex-col overflow-hidden" data-testid="gestao-conversas-page">
      <div className="border-b border-border/70 px-6 pt-3.5 pb-0 flex-shrink-0">
        <div className="flex items-end justify-between gap-4 mb-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/[0.08] ring-1 ring-primary/15 flex items-center justify-center flex-shrink-0">
              <MessagesSquare className="w-4 h-4 text-primary" strokeWidth={2} />
            </div>
            <div className="leading-tight">
              <h1 className="text-[15px] font-semibold tracking-tight" data-testid="text-page-title">Gestão de Conversa</h1>
              <p className="text-[11px] text-muted-foreground/80">Respostas rápidas, campanhas e disparos</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {tabs.map(tab => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`seg-tab ${isActive ? "seg-tab-active" : ""}`}
                data-testid={`tab-${tab.key}`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
          {activeTab === "respostas" && <div key="gc-respostas" className="anim-tab-fade flex-1 min-h-0 overflow-y-auto"><RespostasRapidas embedded /></div>}
          {activeTab === "campanhas" && <div key="gc-campanhas" className="anim-tab-fade flex-1 min-h-0 flex flex-col overflow-hidden"><Campanhas embedded /></div>}
          {activeTab === "disparos" && (
            <div key="gc-disparos" className="anim-tab-fade flex-1 min-h-0 overflow-y-auto">
              <DisparosProgramados embedded />
            </div>
          )}
        </Suspense>
      </div>
    </div>
  );
}
