import { useEffect } from "react";
import { Drawer } from "vaul";
import { X, ExternalLink } from "lucide-react";
import { useLocation } from "wouter";
import { motion, useReducedMotion } from "motion/react";
import Inbox from "@/pages/inbox";

type Props = {
  convId: number | null;
  onClose: () => void;
  /**
   * Quando true, abre o Inbox embarcado em SOMENTE-LEITURA (preview). Default
   * false = INTERATIVO: o admin/atendente responde direto do drawer. Bruno
   * 2026-06-05 — só os Relatórios passam readOnly (contexto de análise); a
   * Central de Atendimentos e Leads abrem interativo.
   */
  readOnly?: boolean;
};

/**
 * Drawer slide-in que renderiza a Inbox inline (sem iframe).
 *
 * Antes esse componente carregava `/inbox?embed=1` num <iframe>, o que fazia
 * o bundle React inteiro re-bootar (auth, WS, queries do zero) toda vez que o
 * usuário clicava numa conversa — daí o delay visível de "tela se formando".
 *
 * Agora o componente Inbox é renderizado direto, compartilhando QueryClient,
 * WebSocket e auth do app pai. Aberturas subsequentes ficam ~instantâneas
 * porque a query da conversa já está no cache.
 */
export function ConversaDrawer({ convId, onClose, readOnly = false }: Props) {
  const [, navigate] = useLocation();
  const open = convId !== null;
  const reduceMotion = useReducedMotion();

  // Trava o scroll do body enquanto o drawer está aberto. Vaul faz isso por
  // padrão, mas como nosso layout usa `overflow-hidden` em outros lugares,
  // garantimos aqui.
  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [open]);

  return (
    <Drawer.Root
      direction="right"
      open={open}
      // Bruno 2026-05-21: modal={true} mantido (default). Vaul aplica
      // `pointer-events: none` no <body> via Radix Dialog scope, MAS isso
      // não afeta dialogs portalizados que setam `pointer-events: auto`
      // EXPLICITAMENTE (CSS specificity: child auto > parent none). Os 4
      // dialogs custom (Edit/Delete/Forward/Resolver) já têm essa garantia.
      // Vantagem: dismiss-on-click-outside automático do vaul continua
      // funcionando — clicar no overlay escurecido fecha o drawer.
      //
      // Tentativa anterior (modal={false}) foi revertida porque vaul retorna
      // null em Drawer.Overlay quando modal=false (vaul/index.mjs:1392) —
      // overlay nem renderiza, dismiss-on-click manual inútil.
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay
          className="fixed inset-0 z-[60] bg-foreground/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <Drawer.Content
          className="fixed inset-y-0 right-0 z-[70] w-[min(1200px,92vw)] outline-none focus-visible:outline-none flex flex-col bg-background shadow-[-24px_0_48px_-12px_rgba(0,0,0,0.18)] border-l border-border"
          aria-describedby={undefined}
        >
          <header className="flex items-center justify-between px-4 h-12 border-b border-border flex-shrink-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            {/* Handle visual sutil pro slide direcional — sinaliza que arrasta/desliza */}
            <div className="flex items-center gap-3">
              <div
                aria-hidden
                className="h-5 w-1 rounded-full bg-border"
              />
              <Drawer.Title className="text-[13px] font-semibold tracking-tight text-foreground">
                Conversa
              </Drawer.Title>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (convId) {
                    onClose();
                    navigate(`/inbox?convId=${convId}`);
                  }
                }}
                className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label="Abrir em tela cheia"
                title="Abrir em tela cheia"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label="Fechar"
                title="Fechar (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </header>

          {convId !== null && (
            <motion.div
              key={convId}
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1], delay: 0.06 }}
              className="flex-1 min-h-0 overflow-hidden"
            >
              <Inbox embedMode initialConvId={convId} onCloseDrawer={onClose} readOnly={readOnly} />
            </motion.div>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
