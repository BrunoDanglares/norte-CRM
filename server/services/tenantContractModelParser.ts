/**
 * Tenant-level contract model parser.
 *
 * Diferente do ispContractParser (que lê contratos individuais por cliente no SGP),
 * este parser lê o MODELO padrão de contrato que o provedor usa com TODOS os clientes.
 *
 * Fluxo: admin faz upload do PDF do contrato modelo → extrai texto → LLM estrutura
 * regras de fidelidade/multa/carência/exceções → admin revisa → salva em
 * tenantSettings.contractModel pra servir de fallback no C4 do agente.
 */
import { resolveOpenAIKeys, isKeyQuotaExceeded, markKeyQuotaExceeded } from './openaiKeyResolver';
import { getOpenAIClient } from './openaiClient';
import { withTimeout } from '../utils/withTimeout';
import type { TenantSettingsJson } from '../../shared/schema';

export type TenantContractRules = NonNullable<TenantSettingsJson['contractModel']>['rules'];

const PDF_TEXT_MAX_CHARS = 18000;

export async function extractTextFromPdfBuffer(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text || '';
  } finally {
    await parser.destroy().catch(() => {});
  }
}

const EMPTY_RULES: TenantContractRules = {
  tem_fidelidade: null,
  meses: null,
  base_calculo_multa: null,
  regra_multa_texto: null,
  multa_fixa_valor: null,
  valor_beneficio_total: null,
  carencia_dias: null,
  excecoes: [],
  taxa_cancelamento_fixa: null,
  clausula_multa_exata: null,
  beneficios_listados: [],
};

export async function parseTenantContractModel(
  pdfText: string,
  workspaceId: string,
): Promise<{ rules: TenantContractRules; rawSnippet: string | null }> {
  const snippet = pdfText.slice(0, PDF_TEXT_MAX_CHARS);
  const candidates = await resolveOpenAIKeys(workspaceId);

  const systemPrompt = `Você extrai regras gerais de um MODELO de contrato de provedor de internet (ISP) brasileiro.
Diferente de contratos individuais, este é o modelo padrão que o provedor usa com todos os clientes —
você está extraindo as REGRAS DE NEGÓCIO que se aplicam em geral, não datas específicas.

Responda APENAS com JSON válido, sem markdown.

Schema:
{
  "tem_fidelidade": true | false | null,
  "meses": <número inteiro do período padrão> | null,
  "base_calculo_multa": "meses_restantes" | "dias_restantes" | "valor_beneficio_proporcional" | "instalacao_proporcional" | "multa_fixa" | "nao_ha" | null,
  "regra_multa_texto": "<descrição curta em pt-br de como a multa é calculada>" | null,
  "multa_fixa_valor": <número em R$, se a multa for valor fixo> | null,
  "valor_beneficio_total": <número em R$ total dos benefícios concedidos> | null,
  "carencia_dias": <dias mínimos antes de aceitar cancelamento, se houver> | null,
  "excecoes": ["morte_titular", "mudanca_sem_cobertura", "culpa_isp", "outras"] | [],
  "taxa_cancelamento_fixa": <número em R$, se há taxa adicional à multa> | null,
  "clausula_multa_exata": "<texto LITERAL da cláusula completa sobre multa, para o agente citar quando o cliente pedir>" | null,
  "beneficios_listados": ["instalação grátis", "modem", "desconto mensal R$ 20 x 12m", ...] | [],
  "raw_snippet": "<trecho do contrato onde achou a regra de multa, até 400 chars>" | null
}

REGRAS CRÍTICAS:
1. NUNCA invente. Se o contrato não menciona, use null ou [] (array vazio).
2. "clausula_multa_exata" DEVE ser literalmente o texto do contrato — copie/cole da cláusula,
   com numeração (ex: "Cláusula 5.3 —"). Isso permite o agente citar na resposta ao cliente.
3. Se o contrato lista benefícios com valores individuais, some tudo em valor_beneficio_total.
4. Detecte "excecoes" com esse vocabulário:
   - "morte_titular": texto menciona morte/falecimento do titular isenta da multa
   - "mudanca_sem_cobertura": mudança para área sem cobertura do provedor
   - "culpa_isp": rescisão por culpa do provedor (CDC Art. 35, etc.)
   - "outras": qualquer outra exceção, descreva no raw_snippet
5. Se a multa é proporcional, identifique a base:
   - "meses_restantes": fórmula usa meses que faltam (ex: "(valor/meses totais) × meses restantes")
   - "valor_beneficio_proporcional": fórmula usa valor do benefício concedido (VB)
   - "instalacao_proporcional": proporcional ao valor da instalação
   - "dias_restantes": usa dias em vez de meses
6. Se há múltiplas opções de período com marcação (X, ☑, [x]), use o marcado.`;

  for (const cand of candidates) {
    if (isKeyQuotaExceeded(cand.apiKey)) continue;
    try {
      const openai = getOpenAIClient({ apiKey: cand.apiKey, baseURL: cand.baseURL, timeout: 35000 });
      const completion = await withTimeout(
        openai.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0,
          max_tokens: 1200,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `TEXTO DO CONTRATO MODELO:\n\n${snippet}` },
          ],
        }),
        45000,
        'LLM tenant contract model parse',
      );
      const raw = completion.choices[0]?.message?.content?.trim() || '{}';
      const parsed = JSON.parse(raw);

      const rules: TenantContractRules = {
        tem_fidelidade: parsed.tem_fidelidade ?? null,
        meses: parsed.meses != null ? Number(parsed.meses) : null,
        base_calculo_multa: parsed.base_calculo_multa ?? null,
        regra_multa_texto: parsed.regra_multa_texto ?? null,
        multa_fixa_valor: parsed.multa_fixa_valor != null ? Number(parsed.multa_fixa_valor) : null,
        valor_beneficio_total: parsed.valor_beneficio_total != null ? Number(parsed.valor_beneficio_total) : null,
        carencia_dias: parsed.carencia_dias != null ? Number(parsed.carencia_dias) : null,
        excecoes: Array.isArray(parsed.excecoes) ? parsed.excecoes.map(String) : [],
        taxa_cancelamento_fixa: parsed.taxa_cancelamento_fixa != null ? Number(parsed.taxa_cancelamento_fixa) : null,
        clausula_multa_exata: parsed.clausula_multa_exata ?? null,
        beneficios_listados: Array.isArray(parsed.beneficios_listados) ? parsed.beneficios_listados.map(String) : [],
      };
      const rawSnippet = parsed.raw_snippet ? String(parsed.raw_snippet).slice(0, 400) : null;

      return { rules, rawSnippet };
    } catch (err: any) {
      if (err.status === 429) markKeyQuotaExceeded(cand.apiKey, workspaceId);
      console.error(`[TenantContractModelParser] LLM FAIL via ${cand.source}: ${err.message}`);
    }
  }

  return { rules: EMPTY_RULES, rawSnippet: null };
}
