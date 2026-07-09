import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import "./history.css";

// Pós-remoção do módulo Protocolos: esta página virou um shell só de CONTATOS.
// A sub-aba "Protocolos" e todo o estado/queries/handlers/JSX que dependiam de
// /api/protocols saíram. O conteúdo de contatos é injetado via `contatosContent`
// (a página de Leads monta a lista/filtros e passa por prop). Mantida viva pela
// rota /atendimento/clientes (modo contatosOnly) e pela aba Histórico de Leads.

interface HistoryPageProps {
  contatosContent?: React.ReactNode;
  activeSubTab?: string;
  onSubTabChange?: (tab: string) => void;
  /** Modo "só contatos": esconde o header da Central + a barra de sub-tabs.
   * Usado pela rota /atendimento/clientes (view focada em atendentes). */
  contatosOnly?: boolean;
}

export default function HistoryPage({ contatosContent, contatosOnly }: HistoryPageProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="history-page" data-testid="history-page">
      {!contatosOnly && (
        <div className="history-header">
          <h1>Contatos</h1>
          <p>Seus contatos e histórico de atendimento em um só lugar</p>
        </div>
      )}

      <AnimatePresence mode="wait" initial={false}>
        {contatosContent && (
          <motion.div
            key="contatos"
            className="history-content"
            data-testid="history-tab-contatos-content"
            style={{ padding: 0 }}
            initial={prefersReducedMotion ? false : { opacity: 0, x: 8 }}
            animate={prefersReducedMotion ? undefined : { opacity: 1, x: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: -8 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          >
            {contatosContent}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
