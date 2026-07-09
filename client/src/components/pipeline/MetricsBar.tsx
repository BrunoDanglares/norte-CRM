import { Activity, Zap, CheckCircle2, Star } from "lucide-react";
import { useMemo } from "react";
import type { Lead } from "@shared/schema";

interface MetricsBarProps {
  leads: Lead[];
  protocolsByPhone: Record<string, any[]>;
}

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function MetricsBar({ leads, protocolsByPhone }: MetricsBarProps) {
  const m = useMemo(() => {
    const todayStart = startOfTodayMs();
    let urgentes = 0;
    let resolvidosHoje = 0;
    let humanos = 0;
    const npsRatings: number[] = [];

    for (const l of leads) {
      const phone = (l.telefone || "").replace(/\D/g, "");
      const protos = phone ? (protocolsByPhone[phone] || protocolsByPhone[l.telefone || ""] || []) : [];
      const activeProto = protos.find((p: any) => p.status === "aberto" || p.status === "em_andamento") || protos[0];
      const prio = activeProto?.prioridade || (l as any).prioridade || "media";

      if (prio === "alta") urgentes++;

      const status = (l.status || "").toLowerCase();
      const createdAt = l.createdAt ? new Date(l.createdAt).getTime() : 0;
      if (/resolvido|finalizado|fechado|ativado/.test(status) && createdAt >= todayStart) {
        resolvidosHoje++;
      }

      if (/humano|atendimento_humano/.test(status)) humanos++;

      if (activeProto?.npsNota && typeof activeProto.npsNota === "number") {
        npsRatings.push(activeProto.npsNota);
      }
    }

    const npsAvg = npsRatings.length > 0
      ? (npsRatings.reduce((a, b) => a + b, 0) / npsRatings.length).toFixed(1)
      : null;

    return {
      total: leads.length,
      urgentes,
      humanos,
      resolvidosHoje,
      npsAvg,
    };
  }, [leads, protocolsByPhone]);

  return (
    <div className="flex items-center gap-2 px-[18px] py-2.5 border-b border-base-200 flex-shrink-0 bg-base-100">
      <MetricPill
        icon={<Activity className="w-3.5 h-3.5" />}
        label="em ativo"
        value={m.total}
        tone="primary"
        spark={m.total > 0}
      />
      <MetricPill
        icon={<Zap className="w-3.5 h-3.5" />}
        label="urgentes"
        value={m.urgentes}
        tone="urgent"
        spark={m.urgentes > 0}
      />
      <MetricPill
        icon={<span className="text-[12px]">👤</span>}
        label="com humano"
        value={m.humanos}
        tone="neutral"
      />
      <MetricPill
        icon={<CheckCircle2 className="w-3.5 h-3.5" />}
        label="resolvidos hoje"
        value={m.resolvidosHoje}
        tone="success"
      />
      {m.npsAvg && (
        <MetricPill
          icon={<Star className="w-3.5 h-3.5 fill-current" />}
          label="NPS médio"
          value={m.npsAvg}
          tone="primary"
        />
      )}
    </div>
  );
}

// Redesign Norte: chip flat (padrão Nexus) — número em text-base-content (PRETO,
// igual ao ERP), ícone/dot em token semântico theme-safe. Antes: gradiente +
// número colorido + hex fixos (quebravam nos temas escuros).
type Tone = "primary" | "urgent" | "neutral" | "success";

function MetricPill({
  icon,
  label,
  value,
  tone,
  spark,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone: Tone;
  spark?: boolean;
}) {
  const iconColor: Record<Tone, string> = {
    primary: "text-primary",
    urgent: "text-error",
    neutral: "text-base-content/50",
    success: "text-success",
  };

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-field border border-base-300 bg-base-100 text-[11.5px] font-semibold transition-colors hover:bg-base-200/50"
      data-testid={`metric-${label}`}
    >
      <span className={`flex items-center justify-center ${iconColor[tone]}`}>
        {icon}
      </span>
      <span className="text-[15px] font-bold tabular-nums leading-none text-base-content">
        {value}
      </span>
      <span className="text-base-content/60 leading-none">{label}</span>
      {spark && Number(value) > 0 && (
        <span className={`inline-block w-1.5 h-1.5 rounded-full animate-pulse ${iconColor[tone].replace("text-", "bg-")}`} />
      )}
    </div>
  );
}
