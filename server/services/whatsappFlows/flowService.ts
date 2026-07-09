// WhatsApp Flows — serviço de envio + processamento de resposta.
// Bruno (2026-05-13): substitui o C11 textual (12 campos digitados linha por
// linha) por formulário nativo do WhatsApp. Cliente preenche em 2 telas
// dentro do chat, submete, e o backend recebe payload estruturado.
//
// Pré-requisitos pra rodar em produção:
//   1. Flow JSON em c11NewCustomerFlow.json publicado no Meta Business Manager
//   2. Env var META_C11_FLOW_ID setada com o ID retornado pela publicação
//   3. Canal Meta Cloud API ativo (whatsappOfficialConnections.status='active')
//      — NÃO funciona no canal não-oficial (limitação técnica do Meta)
//
// Fallback automático: se canal não-Meta ou flow_id ausente, caller deve usar
// o C11 textual existente (sendC11ChecklistAndPersist).

import { db } from '../../db';
import { eq, and } from 'drizzle-orm';
import { conversations, whatsappOfficialConnections, messages } from '@shared/schema';
import { insertMessageWithProtocol } from '../../utils/messageInsert';
import { broadcastToWorkspace } from '../broadcast';

const GRAPH_API_VERSION = 'v21.0';

export interface SendC11FlowParams {
  workspaceId: string;
  conversationId: number;
  body: string;      // texto que aparece no card antes do botão "Preencher"
  ctaLabel?: string; // botão que abre o Flow (default: "Preencher cadastro")
}

export interface FlowSendResult {
  ok: boolean;
  error?: string;
  reason?: 'meta_unavailable' | 'flow_id_missing' | 'flow_not_meta_channel';
  flowToken?: string;
}

/**
 * Verifica se a conv suporta Flows (precisa Meta Cloud API ativo).
 * Retorna conn ou null. Caller decide fallback.
 */
async function resolveMetaConn(workspaceId: string, conversationId: number) {
  const [conv] = await db.select().from(conversations)
    .where(eq(conversations.id, conversationId)).limit(1);
  if (!conv) return { conn: null, conv: null, phone: null };

  // Se conv tem conexaoId de Evolution, NÃO usar Flow
  if ((conv as any).conexaoId) {
    const { conexoes } = await import('@shared/schema');
    const [cnx] = await db.select().from(conexoes)
      .where(and(eq(conexoes.id, (conv as any).conexaoId), eq(conexoes.workspaceId, workspaceId)))
      .limit(1);
    // Evolution: canal não-oficial não tem WhatsApp Flows nativo (Meta-only)
    // → C11 cai no fallback de coleta textual/botões.
    if (cnx && cnx.provider === 'evolution') {
      return { conn: null, conv, phone: (conv.telefone ?? '').replace(/\D/g, '') };
    }
  }

  const [conn] = await db.select().from(whatsappOfficialConnections)
    .where(and(
      eq(whatsappOfficialConnections.workspaceId, workspaceId),
      eq(whatsappOfficialConnections.status, 'active'),
    ))
    .limit(1);
  if (!conn) return { conn: null, conv, phone: (conv.telefone ?? '').replace(/\D/g, '') };

  return { conn, conv, phone: (conv.telefone ?? '').replace(/\D/g, '') };
}

/**
 * Envia o Flow C11 (cadastro novo cliente) pra conv. Cliente vai ver um card
 * com o body e um botão CTA que ABRE o formulário nativo do WhatsApp.
 *
 * Retorna ok=false com reason=meta_unavailable se canal não suporta Flows
 * (caller deve cair pro C11 textual).
 */
export async function sendC11Flow(params: SendC11FlowParams): Promise<FlowSendResult> {
  const flowId = process.env.META_C11_FLOW_ID;
  if (!flowId) {
    console.warn('[Flow] META_C11_FLOW_ID não configurada — fallback pro C11 textual');
    return { ok: false, reason: 'flow_id_missing' };
  }

  const { conn, conv, phone } = await resolveMetaConn(params.workspaceId, params.conversationId);
  if (!conn || !conv || !phone) {
    return { ok: false, reason: 'flow_not_meta_channel' };
  }

  // Token único pra essa instância do flow — vai vir de volta no nfm_reply.
  // Inclui conversationId pra rastrear sem consultar banco de novo.
  const flowToken = `c11_${params.conversationId}_${Date.now().toString(36)}`;

  // Bruno (2026-05-13): testa Flow ANTES de enviar a intro. Se Flow falhar
  // (WABA mismatch caso real: Flow criado em outra conta Meta, erro 131009),
  // intro NÃO é enviada e caller cai em fallback C11 textual sem duplicar
  // mensagens no chat. Quando Flow tem sucesso, intro é enviada DEPOIS pra
  // contextualizar o card que o cliente vai ver.

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${conn.phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'interactive',
    interactive: {
      type: 'flow',
      body: { text: params.body },
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_token: flowToken,
          flow_id: flowId,
          flow_cta: (params.ctaLabel || 'Preencher cadastro').slice(0, 20),
          flow_action: 'navigate',
          flow_action_payload: {
            screen: 'DADOS_PESSOAIS',
          },
          mode: 'published',
        },
      },
    },
  };

  // Tenta enviar ANTES de persistir — se Meta rejeitar (Flow ID inválido, WABA
  // errada, fetch failed), a mensagem NÃO fica no painel. Caller faz fallback
  // pro C11 textual que tem sua própria persistência.
  // Bruno (2026-05-13): bug raiz — antes persistia primeiro, daí mensagem
  // aparecia no painel mas nunca chegava no WhatsApp do cliente quando Flow ID
  // estava inválido. Agora: envia → confirma sucesso → persiste.
  let metaMessageId: string | undefined;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${conn.accessToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    });
    const data = await resp.json() as any;
    if (!resp.ok) {
      console.error('[Flow] Meta API error:', JSON.stringify(data?.error || data).slice(0, 500));
      return { ok: false, error: data?.error?.message ?? 'Erro Meta API' };
    }
    metaMessageId = data?.messages?.[0]?.id;
  } catch (err: any) {
    console.error('[Flow] send exception:', err.message);
    return { ok: false, error: err.message };
  }

  // Envio confirmado pela Meta — persiste no painel e dispara broadcast.
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  try {
    // Texto persistido = body que o cliente viu no card. O frontend renderiza
    // o botão "Preencher cadastro" visualmente a partir do `arquivo` (meta
    // JSON com interactiveType='flow' + cta). Antes incluíamos o marcador
    // textual "📋 Formulário interativo enviado..." pra atendente entender,
    // mas isso virou ruído com o render visual nativo. (Bruno, 2026-05-14)
    const savedMsg = await insertMessageWithProtocol({
      conversationId: params.conversationId,
      workspaceId: params.workspaceId,
      direction: 'out',
      texto: params.body,
      tipo: 'interactive',
      arquivo: JSON.stringify({
        interactiveType: 'flow',
        flowId,
        flowToken,
        cta: params.ctaLabel || 'Preencher cadastro',
        metaMessageId,
      }),
      hora,
      status: 'sent',
      agente: 'Banana AI',
    });
    broadcastToWorkspace(params.workspaceId, 'new_message', {
      conversationId: params.conversationId,
      message: savedMsg,
    });
  } catch (e: any) {
    // Falha de persistência NÃO derruba o envio bem-sucedido — Meta já entregou
    // ao cliente. Log de aviso e segue.
    console.warn(`[Flow] persist outbound err (envio OK): ${e.message}`);
  }

  console.log(`[Flow] ✅ enviado conv=${params.conversationId} flowToken=${flowToken}`);
  return { ok: true, flowToken };
}

// ─── PROCESSAMENTO DE RESPOSTA ──────────────────────────────────────────────

export interface C11FlowResponse {
  flowToken: string;
  conversationId: number | null;
  data: {
    tipo_cadastro?: 'pessoa_fisica' | 'pessoa_juridica' | string;
    nome_completo?: string;
    cpf?: string;       // PF (11 dígitos)
    cnpj?: string;      // PJ (14 dígitos)
    documento?: string; // valor bruto recebido (compat)
    data_nascimento?: string;
    email?: string;
    cep?: string;
    endereco?: string;
    ponto_referencia?: string;
    wifi_ssid?: string;
    wifi_senha?: string;
    como_soube?: string;
  };
}

/**
 * Parsea o payload nfm_reply do webhook Meta. Retorna null se não for C11.
 * Estrutura esperada do nfm_reply:
 *   { response_json: '<JSON stringified com data submetido>', name: 'flow', body: '...' }
 */
export function parseC11FlowReply(nfmReply: any): C11FlowResponse | null {
  if (!nfmReply || nfmReply.name !== 'flow') return null;
  let parsed: any;
  try {
    parsed = typeof nfmReply.response_json === 'string'
      ? JSON.parse(nfmReply.response_json)
      : nfmReply.response_json;
  } catch (e: any) {
    console.error('[Flow] erro parseando response_json:', e.message);
    return null;
  }
  if (!parsed) return null;

  // flow_token vem com nosso prefixo "c11_<conversationId>_<rand>"
  const flowToken: string = parsed.flow_token || nfmReply.flow_token || '';
  if (!flowToken.startsWith('c11_')) return null;

  const conversationIdMatch = flowToken.match(/^c11_(\d+)_/);
  const conversationId = conversationIdMatch ? Number(conversationIdMatch[1]) : null;

  // Dados podem vir flat OU dentro de uma chave "data" — defensivo
  const data = parsed.data || parsed;

  // Coerce de campos numéricos pra string. Documento (CPF/CNPJ) e CEP usam
  // input-type="number" no Flow (forçar teclado numérico) — chegam como number.
  // PF: documento tem 11 dígitos = CPF. PJ: 14 dígitos = CNPJ. Detecção dual:
  // primeiro usa tipo_cadastro do dropdown, fallback pelo length.
  const cepStr = data.cep !== undefined && data.cep !== null
    ? String(data.cep).replace(/\D/g, '').padStart(8, '0').slice(0, 8)
    : undefined;

  const tipoCadastro = data.tipo_cadastro as string | undefined;
  const docRaw = data.documento !== undefined && data.documento !== null
    ? String(data.documento).replace(/\D/g, '')
    : (data.cpf !== undefined && data.cpf !== null
        ? String(data.cpf).replace(/\D/g, '')
        : '');
  let cpfStr: string | undefined;
  let cnpjStr: string | undefined;
  if (docRaw) {
    const isPJ = tipoCadastro === 'pessoa_juridica' || docRaw.length > 11;
    if (isPJ) {
      cnpjStr = docRaw.padStart(14, '0').slice(0, 14);
    } else {
      cpfStr = docRaw.padStart(11, '0').slice(0, 11);
    }
  }

  return {
    flowToken,
    conversationId,
    data: {
      tipo_cadastro: tipoCadastro,
      nome_completo: data.nome_completo,
      cpf: cpfStr,
      cnpj: cnpjStr,
      documento: docRaw || undefined,
      data_nascimento: data.data_nascimento,
      email: data.email,
      cep: cepStr,
      endereco: data.endereco,
      ponto_referencia: data.ponto_referencia,
      wifi_ssid: data.wifi_ssid,
      wifi_senha: data.wifi_senha,
      como_soube: data.como_soube,
    },
  };
}

/**
 * Resumo CURTO de 1 linha do cadastro preenchido — usado como `messageText`
 * do inbound do cliente no painel CRM. Substitui o texto técnico
 * "[formulário-cadastro-recebido]" por algo legível pro atendente.
 *
 * Exemplo: "📋 Cadastro preenchido — Bruno Danglares · CPF 012.988.642-40 · CEP 68365-000"
 */
export function formatC11FlowReplyShort(data: C11FlowResponse['data']): string {
  const nome = (data.nome_completo || '').trim();
  const cpfRaw = (data.cpf || '').replace(/\D/g, '');
  const cpfFmt = cpfRaw.length === 11
    ? cpfRaw.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
    : cpfRaw;
  const cepRaw = (data.cep || '').replace(/\D/g, '');
  const cepFmt = cepRaw.length === 8
    ? cepRaw.replace(/^(\d{5})(\d{3})$/, '$1-$2')
    : cepRaw;

  const parts: string[] = [];
  if (nome) parts.push(nome);
  if (cpfFmt) parts.push(`CPF ${cpfFmt}`);
  if (cepFmt) parts.push(`CEP ${cepFmt}`);

  return parts.length
    ? `📋 Cadastro preenchido — ${parts.join(' · ')}`
    : '📋 Cadastro preenchido via formulário';
}

/**
 * Monta resumo formatado pro handoff humano (vai como mensagem outbound +
 * pode ir como nota interna no protocolo).
 */
export function formatC11FlowDataForHandoff(data: C11FlowResponse['data']): string {
  const lines: string[] = ['📋 *Cadastro recebido via formulário:*', ''];
  const tipoLabel = data.tipo_cadastro === 'pessoa_juridica' ? 'Pessoa Jurídica' : 'Pessoa Física';
  lines.push(`🏷️ *Tipo:* ${tipoLabel}`);
  if (data.nome_completo) {
    const labelNome = data.tipo_cadastro === 'pessoa_juridica' ? 'Razão Social' : 'Nome';
    lines.push(`👤 *${labelNome}:* ${data.nome_completo}`);
  }
  if (data.cpf) lines.push(`📄 *CPF:* ${data.cpf}`);
  if (data.cnpj) lines.push(`📄 *CNPJ:* ${data.cnpj}`);
  if (data.data_nascimento) {
    const labelData = data.tipo_cadastro === 'pessoa_juridica' ? 'Fundação' : 'Nascimento';
    lines.push(`📅 *${labelData}:* ${data.data_nascimento}`);
  }
  if (data.email) lines.push(`✉️ *E-mail:* ${data.email}`);
  if (data.cep) lines.push(`📍 *CEP:* ${data.cep}`);
  if (data.endereco) lines.push(`🏠 *Endereço:* ${data.endereco}`);
  if (data.ponto_referencia) lines.push(`📌 *Referência:* ${data.ponto_referencia}`);
  if (data.wifi_ssid) lines.push(`🌐 *Wi-Fi:* ${data.wifi_ssid}`);
  if (data.como_soube) lines.push(`📣 *Origem:* ${data.como_soube}`);
  return lines.join('\n');
}
