// Wrapper opcional do Sentry pra captura de erros em produção (Bruno,
// hardening 2026-05-03).
//
// COMO ATIVAR:
//   1. Criar conta em https://sentry.io (free tier 5k events/mês)
//   2. Criar projeto Node.js, copiar DSN
//   3. No .env do EasyPanel:
//        SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>
//        SENTRY_ENVIRONMENT=production  (opcional)
//        SENTRY_TRACES_SAMPLE_RATE=0.1  (opcional, default 0)
//   4. Instalar dependência: `npm install @sentry/node`
//   5. Restart do container
//
// COMPORTAMENTO SEM CONFIGURAR:
//   - SENTRY_DSN não setado → módulo vira no-op (zero overhead, zero erro)
//   - @sentry/node não instalado → idem
//   - Aplicação roda exatamente como antes
//
// PRINCÍPIO: ativação progressiva sem quebrar nada se algo der errado no
// setup do Sentry. Erros do próprio Sentry NUNCA derrubam a aplicação.

let sentryActive = false;
let sentryModule: any = null;

export async function initSentryIfConfigured(): Promise<void> {
  const dsn = process.env.SENTRY_DSN || '';
  if (!dsn) {
    console.log('[Sentry] SENTRY_DSN não configurado — captura de erros desligada');
    return;
  }

  try {
    // Import dinâmico — não exige @sentry/node instalado se não for usar.
    // @ts-ignore — @sentry/node é dependência opcional, pode não estar no package.json
    sentryModule = await import('@sentry/node').catch(() => null);
    if (!sentryModule) {
      console.warn('[Sentry] SENTRY_DSN setado mas @sentry/node não instalado. Rode: npm install @sentry/node');
      return;
    }

    sentryModule.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0'),
      // Não capturar PII por padrão — cliente final tem dados sensíveis
      sendDefaultPii: false,
      // Filtra erros conhecidos/triviais antes de enviar
      beforeSend(event: any, hint: any) {
        const error = hint?.originalException;
        const msg = (error?.message || '').toLowerCase();
        // Erros de rede transientes — não vale gastar quota
        if (msg.includes('socket hang up') || msg.includes('econnreset')) return null;
        // Quota OpenAI esgotada — já logado e tratado pela aplicação
        if (msg.includes('quota') || msg.includes('rate limit')) return null;
        return event;
      },
    });

    sentryActive = true;
    console.log(`[Sentry] ativo (env=${process.env.SENTRY_ENVIRONMENT || 'production'})`);
  } catch (err: any) {
    // Erro no setup do Sentry NÃO derruba a aplicação
    console.error(`[Sentry] falha no init (não bloqueante): ${err.message}`);
    sentryModule = null;
    sentryActive = false;
  }
}

/** Captura exceção manualmente. No-op se Sentry não estiver ativo. */
export function captureException(error: any, context?: Record<string, any>): void {
  if (!sentryActive || !sentryModule) return;
  try {
    if (context) {
      sentryModule.withScope((scope: any) => {
        for (const [k, v] of Object.entries(context)) {
          scope.setExtra(k, v);
        }
        sentryModule.captureException(error);
      });
    } else {
      sentryModule.captureException(error);
    }
  } catch {
    // Sentry erro = ignora silenciosamente
  }
}

/** Captura mensagem (warning, info). No-op se Sentry não estiver ativo. */
export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
  if (!sentryActive || !sentryModule) return;
  try {
    sentryModule.captureMessage(message, level);
  } catch {}
}

/** Express error handler — adiciona stack do request quando o erro chega no middleware. */
export function sentryErrorHandler() {
  return (err: any, req: any, res: any, next: any) => {
    if (sentryActive && sentryModule) {
      try {
        sentryModule.withScope((scope: any) => {
          scope.setTag('http.method', req.method);
          scope.setTag('http.path', req.path);
          if (req.user?.workspaceId) scope.setTag('workspace_id', req.user.workspaceId);
          sentryModule.captureException(err);
        });
      } catch {}
    }
    next(err);
  };
}

/** Para testes manuais e health check */
export function isSentryActive(): boolean {
  return sentryActive;
}
