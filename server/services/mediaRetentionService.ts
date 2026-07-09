// Retenção de mídia recebida do cliente (foto, áudio, PDF) com policy LGPD.
//
// Fluxo:
//   1. registerMediaAsset() é chamado todo download (Meta, Evolution, Instagram)
//      e cria um registro em media_assets com expires_at = now() + retentionDays.
//   2. purgeExpiredMedia() roda em cron diário, apaga arquivos físicos cujo
//      expires_at já passou e marca purged_at. O REGISTRO NÃO É DELETADO —
//      auditoria precisa saber que existiu mídia mesmo após a purga.
//
// Categoria é heurística:
//   - 'comprovante_pagto' quando contexto é financeiro
//   - 'led_onu' quando contexto é suporte técnico
//   - 'documento' quando é PDF
//   - 'unclassified' quando não dá pra inferir
//
// Em caso de erro de DB, o registro é skip silencioso — NÃO quebra o fluxo
// de mensagem do cliente. LGPD não pode prejudicar UX.

import { db } from '../db';
import { mediaAssets, type MediaAsset } from '@shared/schema';
import { eq, and, isNull, lte, sql } from 'drizzle-orm';
import { existsSync, unlinkSync } from 'fs';
import { resolve as pathResolve } from 'path';

export type MediaCategory =
  | 'comprovante_pagto'
  | 'led_onu'
  | 'documento'
  | 'unclassified';

export type MediaSource = 'meta' | 'instagram' | 'evolution';

export interface RegisterMediaInput {
  workspaceId: string;
  conversationId?: number | null;
  mediaUrl: string;          // ex: /uploads/meta_xxx.jpeg
  mimeType?: string | null;
  category?: MediaCategory;  // default 'unclassified'
  source?: MediaSource;
  retentionDays?: number;    // default 30 (lê do tenant settings se nada vier)
}

const DEFAULT_RETENTION_DAYS = 30;

/**
 * Heurística de categorização baseada no mime e (opcionalmente) no flow ativo
 * do agente. Pode ser refinada depois quando o agente reconhece o contexto.
 */
export function inferMediaCategory(opts: {
  mimeType?: string | null;
  agentFlow?: string | null;  // 'FINANCEIRO' | 'SUPORTE_TECNICO' | etc.
}): MediaCategory {
  const flow = (opts.agentFlow || '').toUpperCase();
  if (flow === 'FINANCEIRO') return 'comprovante_pagto';
  if (flow === 'SUPORTE_TECNICO' || flow === 'SUPORTE') return 'led_onu';

  const mime = (opts.mimeType || '').toLowerCase();
  if (mime.includes('pdf')) return 'documento';

  return 'unclassified';
}

/**
 * Registra uma mídia recém-baixada com data de expiração calculada a partir
 * do retentionDays (parâmetro ou default 30). Best-effort: erro vira warn,
 * nunca propaga.
 */
export async function registerMediaAsset(input: RegisterMediaInput): Promise<void> {
  try {
    const retention = input.retentionDays ?? DEFAULT_RETENTION_DAYS;
    if (!input.mediaUrl) return;

    const expiresAt = new Date(Date.now() + retention * 24 * 60 * 60 * 1000);

    await db
      .insert(mediaAssets)
      .values({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId ?? null,
        mediaUrl: input.mediaUrl,
        mimeType: input.mimeType ?? null,
        category: input.category ?? 'unclassified',
        expiresAt,
        source: input.source ?? null,
      })
      .onConflictDoNothing({ target: mediaAssets.mediaUrl });
  } catch (err: any) {
    // Se a tabela ainda não foi criada (primeiro boot da migration) ou se
    // houve erro de DB, NÃO quebra o fluxo de mensagem.
    console.warn(`[MediaRetention] registerMediaAsset failed: ${err?.message || err}`);
  }
}

/**
 * Apaga arquivos físicos cujo expires_at já passou e marca purged_at no
 * registro. Roda em cron diário. Retorna estatística pra log.
 */
export async function purgeExpiredMedia(opts?: {
  batchSize?: number;
}): Promise<{ purged: number; missing: number; errors: number }> {
  const batchSize = opts?.batchSize ?? 200;
  let purged = 0, missing = 0, errors = 0;

  let expired: MediaAsset[] = [];
  try {
    expired = await db
      .select()
      .from(mediaAssets)
      .where(and(
        isNull(mediaAssets.purgedAt),
        lte(mediaAssets.expiresAt, sql`now()`),
      ))
      .limit(batchSize);
  } catch (err: any) {
    console.error(`[MediaRetention] purge query failed: ${err?.message || err}`);
    return { purged: 0, missing: 0, errors: 1 };
  }

  for (const asset of expired) {
    try {
      // mediaUrl é tipo /uploads/xxx.jpeg — converter pra path absoluto
      const relPath = asset.mediaUrl.startsWith('/')
        ? asset.mediaUrl.slice(1)
        : asset.mediaUrl;
      const absPath = pathResolve(relPath);

      if (existsSync(absPath)) {
        unlinkSync(absPath);
        purged++;
      } else {
        missing++; // arquivo já foi removido por outro processo — ok, segue
      }

      // Marca purgedAt mesmo que o arquivo não exista (registro fica auditável)
      await db
        .update(mediaAssets)
        .set({ purgedAt: new Date() })
        .where(eq(mediaAssets.id, asset.id));
    } catch (err: any) {
      console.error(`[MediaRetention] purge failed for ${asset.mediaUrl}: ${err?.message || err}`);
      errors++;
    }
  }

  if (purged + missing + errors > 0) {
    console.log(`[MediaRetention] purge: ${purged} apagados, ${missing} ausentes, ${errors} erros (batch ${batchSize})`);
  }

  return { purged, missing, errors };
}

/**
 * Atalho pra resolver retentionDays do tenant. Caller que tem o workspaceId
 * mas não quer importar tenantSettingsService usa este wrapper.
 */
export async function getRetentionDaysForTenant(workspaceId: string): Promise<number> {
  try {
    const { tenantSettingsService } = await import('./tenantSettingsService');
    const settings = await tenantSettingsService.getTenantSettings(workspaceId);
    return settings.compliance?.mediaRetentionDays ?? DEFAULT_RETENTION_DAYS;
  } catch {
    return DEFAULT_RETENTION_DAYS;
  }
}
