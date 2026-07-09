import type { Express } from "express";
import { requireAuth } from "../middleware/auth";
import { safeErr } from "../utils/helpers";
import { tenantSettingsService } from "../services/tenantSettingsService";
import type { TenantSettingsJson } from "@shared/schema";
import { formatServiceHoursAsText, deriveSuporteFimDeSemana } from "../utils/serviceHours";

function parseHolidayLines(raw: string): string[] {
  if (!raw || typeof raw !== 'string') return [];
  const out: string[] = [];
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (!m) continue;
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    if (m[3]) {
      const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
      out.push(`${yyyy}-${mm}-${dd}`);
    } else {
      out.push(`${mm}-${dd}`);
    }
  }
  return Array.from(new Set(out));
}

function mapQuestionnaireToRules(answers: Record<string, any>, current: TenantSettingsJson): Partial<TenantSettingsJson> {
  const br = { ...current.businessRules };
  const sh = { ...current.serviceHours };

  if (answers.q20) {
    const methods = answers.q20 as string[];
    br.allowPix = methods.includes('Pix');
    br.allowBarcode = methods.includes('Boleto bancário');
  }

  if (answers.q26 === 'Sim') br.allowTrustUnlock = true;
  if (answers.q26 === 'Não') br.allowTrustUnlock = false;

  if (answers.q80 === 'Sim — abertura via API') br.allowAutoOpenTicket = true;
  if (answers.q80 === 'Não — apenas pelo sistema interno') br.allowAutoOpenTicket = false;

  if (answers.q117?.startsWith('Sim')) br.askRouterBeforeEscalateOffline = true;
  if (answers.q117?.startsWith('Não')) br.askRouterBeforeEscalateOffline = false;

  if (answers.q78?.includes('Cabo') || answers.q78?.includes('cabo')) br.requireRebootStep = true;

  if (answers.q4) {
    const estiloMap: Record<string, 'direto' | 'consultivo' | 'adaptativo'> = {
      'Direto — responde rápido e objetivo': 'direto',
      'Consultivo — explica antes de agir, orienta o cliente': 'consultivo',
      'Adapta conforme a situação': 'adaptativo',
    };
    br.estiloResposta = estiloMap[answers.q4];
  }

  if (answers.q48) {
    const tomMap: Record<string, 'amigavel' | 'progressivo' | 'firme'> = {
      'Amigável — lembrete gentil': 'amigavel',
      'Progressivo — começa amigável e endurece com o atraso': 'progressivo',
      'Firme — comunicação clara de inadimplência': 'firme',
    };
    br.tomCobranca = tomMap[answers.q48];
  }

  if (answers.q27) {
    const m = String(answers.q27).match(/\d+/);
    if (m) br.promessaDias = parseInt(m[0]);
  }
  if (answers.q28) {
    const m = String(answers.q28).match(/\d+/);
    if (m) br.promessasPerMonth = parseInt(m[0]);
  }
  // q37, q38, q39 removidos em 2026-04-23 (v2 consolidou em q136/q138/q137).
  // Campos legados `parcelamentoMax` e `descontoAVistaMax` mantidos no tipo
  // pra retrocompat, mas a fonte agora é q136 / q138 via `parcelamentoDividaMax`
  // e `descontoAvistaDividaMax` (ver seção "Questionário v2" abaixo).

  if (answers.q110) {
    const acaoMap: Record<string, 'apresentar_planos' | 'oferecer_desconto' | 'escalar_comercial' | 'escalar_humano'> = {
      'Apresentar planos mais baratos disponíveis': 'apresentar_planos',
      'Oferecer desconto de retenção': 'oferecer_desconto',
      'Encaminhar para equipe comercial negociar': 'escalar_comercial',
      'Escalar para humano sem oferecer alternativas': 'escalar_humano',
    };
    br.f10Acao = acaoMap[answers.q110];
  }

  if (answers.q82) br.slaEmergencia = String(answers.q82);
  if (answers.q83) br.slaComum = String(answers.q83);

  if (answers.q111) {
    const acaoMap: Record<string, 'abrir_os' | 'orientar_teste' | 'escalar_noc' | 'informar_congestionamento'> = {
      'Coletar os horários e abrir OS de investigação': 'abrir_os',
      'Orientar teste de velocidade no horário do problema e retornar': 'orientar_teste',
      'Escalar para NOC/equipe técnica com os horários': 'escalar_noc',
      'Informar que pode haver congestionamento na região e monitorar': 'informar_congestionamento',
    };
    br.s6Acao = acaoMap[answers.q111];
  }

  if (answers.q120) {
    const map: Record<string, 'sim' | 'nao' | 'parcial'> = {
      'Sim — todos os roteadores têm 5GHz': 'sim',
      'Apenas em alguns planos/equipamentos': 'parcial',
      'Não — apenas Wi-Fi 2.4GHz': 'nao',
    };
    br.roteadorOferece5g = map[answers.q120];
  }

  // q76 agora é radio com 5 opções. q121 só se aplica quando q76 = "Valor fixo em Mbps".
  // Quando q76 é "% abaixo", o agente calcula o limite em runtime (plano × %).
  // Mapeia o modo em `toleranciaVelocidadeModo`; `velocidadeMinimaSpeedtest` continua
  // carregando o valor absoluto em Mbps (usado quando modo = 'mbps').
  if (answers.q76) {
    const modoMap: Record<string, 'pct_20' | 'pct_30' | 'pct_50' | 'qualquer' | 'mbps'> = {
      'Até 20% abaixo do plano (recomendado)': 'pct_20',
      'Até 30% abaixo do plano': 'pct_30',
      'Até 50% abaixo do plano': 'pct_50',
      'Qualquer valor abaixo do plano contratado': 'qualquer',
      'Valor fixo em Mbps (preencha abaixo)': 'mbps',
    };
    (br as any).toleranciaVelocidadeModo = modoMap[answers.q76];
  }
  if (answers.q121 && answers.q76 === 'Valor fixo em Mbps (preencha abaixo)') {
    const m = String(answers.q121).match(/\d+/);
    if (m) br.velocidadeMinimaSpeedtest = parseInt(m[0], 10);
  }

  if (answers.q112) {
    const acaoMap: Record<string, 'verificar_ssid' | 'reset_fabrica' | 'abrir_os' | 'escalar_humano'> = {
      'Verificar SSID remotamente e orientar reinício do equipamento': 'verificar_ssid',
      'Orientar reset de fábrica do roteador': 'reset_fabrica',
      'Abrir OS para visita técnica': 'abrir_os',
      'Escalar para suporte técnico humano': 'escalar_humano',
    };
    br.s11Acao = acaoMap[answers.q112];
  }


  if (answers.q114) {
    const permitidoMap: Record<string, 'tudo' | 'velocidade' | 'nao'> = {
      'Sim — todas as informações via API': 'tudo',
      'Sim — apenas velocidade contratada': 'velocidade',
      'Não — encaminha para atendente humano': 'nao',
    };
    br.s13Permitido = permitidoMap[answers.q114];
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ── Questionário v2 (2026-04-23) — perguntas q130-q157 ─────────────────
  // ═══════════════════════════════════════════════════════════════════════

  // A1 — Cartão de crédito recorrente
  if (answers.q130 !== undefined) (br as any).allowCardRecurring = answers.q130 === 'Sim';
  if (answers.q131) (br as any).cardGateway = String(answers.q131);

  // A2 — Emissão de NF-e
  if (answers.q132) {
    const nfeMap: Record<string, 'automatica' | 'manual' | 'nao'> = {
      'Sim, automática após pagamento': 'automatica',
      'Sim, manual pela equipe': 'manual',
      'Não emite': 'nao',
    };
    (br as any).emiteNFE = nfeMap[answers.q132];
  }
  if (answers.q133) {
    const m = String(answers.q133).match(/\d+/);
    if (m) (br as any).prazoNFEDias = parseInt(m[0], 10);
  }

  // A3 — Prazo análise de pagamento não reconhecido (F11)
  if (answers.q134) (br as any).prazoAnaliseComprovante = String(answers.q134);

  // A4 — Regra de multa proporcional (C4 refinado)
  if (answers.q135) (br as any).multaProporcionalRegra = String(answers.q135);

  // A5 — Parcelamento de dívida acumulada
  if (answers.q136) {
    const m = String(answers.q136).match(/\d+/);
    if (m) (br as any).parcelamentoDividaMax = parseInt(m[0], 10);
  }
  if (answers.q137) {
    const valor = String(answers.q137).replace(/[^\d,.]/g, '').replace(',', '.');
    const num = parseFloat(valor);
    if (!isNaN(num)) (br as any).parcelamentoValorMinimo = num;
  }

  // A6 — Desconto à vista na dívida
  if (answers.q138) (br as any).descontoAvistaDividaMax = String(answers.q138);

  // A7 — Crédito em conta
  if (answers.q139) {
    const creditoMap: Record<string, 'agente' | 'humano' | 'nao'> = {
      'Agente informa política e encaminha': 'agente',
      'Só humano analisa': 'humano',
      'Provedor não oferece': 'nao',
    };
    (br as any).creditoContaPolicy = creditoMap[answers.q139];
  }

  // A8 — Débito recusado fluxo
  if (answers.q140) (br as any).debitoRecusadoFluxo = String(answers.q140);

  // B1 — Sem energia policy (S14)
  if (answers.q141) {
    const energiaMap: Record<string, 'orientar' | 'abrir_os' | 'registrar'> = {
      'Orientar a voltar quando normalizar (NÃO abrir OS)': 'orientar',
      'Abrir OS mesmo assim': 'abrir_os',
      'Só registrar observação': 'registrar',
    };
    (br as any).semEnergiaPolicy = energiaMap[answers.q141];
  }

  // B2 — Canal de aviso de manutenção (S15)
  if (answers.q142) {
    const tipoMap: Record<string, 'status_page' | 'grupo_whatsapp' | 'sms' | 'nenhum' | 'outro'> = {
      'Status page (URL)': 'status_page',
      'Grupo WhatsApp': 'grupo_whatsapp',
      'SMS': 'sms',
      'Não tem canal': 'nenhum',
      'Outro': 'outro',
    };
    const tipo = tipoMap[answers.q142] ?? 'nenhum';
    (br as any).canalAvisoManutencao = { tipo, link: answers.q143 ? String(answers.q143) : undefined };
  }

  // B3 — Modelos de equipamento estruturados
  if (answers.q144 && Array.isArray(answers.q144)) (br as any).onuModelos = answers.q144 as string[];
  if (answers.q145 && Array.isArray(answers.q145)) (br as any).roteadorModelos = answers.q145 as string[];

  // B4 — Horário de OS automática
  if (answers.q146) {
    const osMap: Record<string, '24x7' | 'comercial' | 'nunca'> = {
      '24 horas por dia, 7 dias por semana': '24x7',
      'Apenas horário comercial': 'comercial',
      'Não permite abertura automática': 'nunca',
    };
    (br as any).osAutomaticaHorario = osMap[answers.q146];
  }

  // B5 — Porta bloqueada policy (S16)
  if (answers.q147) {
    const portaMap: Record<string, 'escalar' | 'abrir_os' | 'explicar_limitacao'> = {
      'Escalar pro suporte humano (NOC)': 'escalar',
      'Abrir OS com tag porta_bloqueada': 'abrir_os',
      'Explicar limitação e oferecer workaround/IP fixo': 'explicar_limitacao',
    };
    (br as any).portaBloqueadaPolicy = portaMap[answers.q147];
  }

  // C1 — Taxas de instalação estruturadas por plano
  if (answers.q148 && Array.isArray(answers.q148)) {
    (br as any).taxasInstalacao = (answers.q148 as any[])
      .filter(it => it && typeof it === 'object' && it.planoNome)
      .map(it => ({
        planoNome: String(it.planoNome),
        taxaInstalacao: Number(it.taxaInstalacao) || 0,
        condicaoIsencao: it.condicaoIsencao ? String(it.condicaoIsencao) : undefined,
      }));
  }

  // C1b — Prazo típico de instalação (q57b)
  if (answers.q57b && typeof answers.q57b === 'string' && answers.q57b.trim()) {
    (br as any).prazoInstalacao = String(answers.q57b).trim();
  }

  // C2 — Mudança de endereço
  if (answers.q149) {
    const mudancaMap: Record<string, 'mantem' | 'reinicia' | 'taxa' | 'humano'> = {
      'Mantém a fidelidade do contrato atual': 'mantem',
      'Reinicia a fidelidade': 'reinicia',
      'Cobra uma taxa de mudança': 'taxa',
      'Escala pra humano decidir': 'humano',
    };
    (br as any).mudancaEnderecoFidelidade = mudancaMap[answers.q149];
  }
  if (answers.q150) {
    const valor = String(answers.q150).replace(/[^\d,.]/g, '').replace(',', '.');
    const num = parseFloat(valor);
    if (!isNaN(num)) (br as any).mudancaEnderecoTaxa = num;
  }

  // C3 — Split de conta
  if (answers.q151 !== undefined) (br as any).splitConta = answers.q151 === 'Sim';

  // q152 removido — benefício de indicação agora vem de q65_detail (consolidado).
  if (answers.q65 === 'Sim' && answers.q65_detail) (br as any).indicacaoBeneficio = String(answers.q65_detail);

  // ─── FAQ: Atraso, Suspensão e Liberação ─────────────────────────────────
  // q165 — dias até suspensão por inadimplência
  if (answers.q165 && typeof answers.q165 === 'string' && answers.q165.trim()) {
    const num = parseInt(String(answers.q165).replace(/\D/g, ''));
    if (!isNaN(num) && num > 0) (br as any).diasCorteAposVencimento = num;
  }
  // q166 — multa/juros por atraso (texto livre)
  if (answers.q166 && typeof answers.q166 === 'string' && answers.q166.trim()) {
    (br as any).multaJurosAtraso = String(answers.q166).trim();
  }
  // q167 — desconto por pagamento antecipado da mensalidade
  if (answers.q167 && typeof answers.q167 === 'string' && answers.q167.trim()) {
    (br as any).descontoPagamentoAntecipado = String(answers.q167).trim();
  }
  // q168 — tempo até liberação após pagamento confirmado
  if (answers.q168 && typeof answers.q168 === 'string' && answers.q168.trim()) {
    (br as any).tempoLiberacaoAposPagamento = String(answers.q168).trim();
  }
  // q176 — desconto de PONTUALIDADE (paga menor até o vencimento, cheio depois).
  // Bruno 2026-06-16. Só grava quando respondido; ausência = sem desconto.
  if (answers.q176 && typeof answers.q176 === 'string' && answers.q176.trim()) {
    (br as any).descontoPontualidade = String(answers.q176).trim().toLowerCase() === 'sim';
  }

  // ─── FAQ: Atendimento humano e visita técnica ───────────────────────────
  // q173 — horário do atendimento humano. Se vazio, deriva do serviceHours
  // do workspace (Configurações > Horários de Atendimento). Se preenchido,
  // o texto livre prevalece (override manual).
  const q173Manual = typeof answers.q173 === 'string' ? answers.q173.trim() : '';
  if (q173Manual) {
    (br as any).horarioAtendimentoHumano = q173Manual;
  } else {
    const derived = formatServiceHoursAsText(current.serviceHours);
    if (derived) (br as any).horarioAtendimentoHumano = derived;
  }
  // q172 — atende suporte em FDS. Se vazio, deriva de serviceHours.saturday/sunday.
  if (answers.q172) {
    const fdsMap: Record<string, 'sim_sab' | 'sim_sab_dom' | 'somente_urgencia' | 'nao'> = {
      'Sim — sábado': 'sim_sab',
      'Sim — sábado e domingo': 'sim_sab_dom',
      'Apenas casos de urgência (24h)': 'somente_urgencia',
      'Não — apenas dias úteis': 'nao',
    };
    const v = fdsMap[answers.q172];
    if (v) (br as any).suporteFimDeSemana = v;
  } else {
    (br as any).suporteFimDeSemana = deriveSuporteFimDeSemana(current.serviceHours);
  }
  // q174 — presença para visita técnica
  if (answers.q174) {
    const presMap: Record<string, 'sim_qualquer' | 'sim_maior_18' | 'preferencial' | 'nao'> = {
      'Sim — qualquer pessoa': 'sim_qualquer',
      'Sim — apenas maior de 18 anos': 'sim_maior_18',
      'Preferencial mas não obrigatório': 'preferencial',
      'Não — temos chave/acesso autorizado': 'nao',
    };
    const v = presMap[answers.q174];
    if (v) (br as any).requerPresencaParaVisita = v;
  }

  // ─── FAQ: Equipamentos (roteador) ────────────────────────────────────────
  // q170 — modalidade do roteador
  if (answers.q170) {
    const rotMap: Record<string, 'comodato' | 'compra_obrigatoria' | 'aluguel_mensal' | 'cliente_compra_opcional' | 'cliente_traz_proprio' | 'nao_fornece'> = {
      'Sim — em comodato (cliente devolve no cancelamento)': 'comodato',
      'Sim — venda obrigatória do roteador junto com o plano': 'compra_obrigatoria',
      'Sim — aluguel mensal cobrado na fatura': 'aluguel_mensal',
      'Sim — venda opcional (cliente pode comprar conosco ou trazer o próprio)': 'cliente_compra_opcional',
      'Não — cliente sempre traz o próprio roteador': 'cliente_traz_proprio',
      'Não fornece roteador': 'nao_fornece',
    };
    const v = rotMap[answers.q170];
    if (v) (br as any).roteadorFornecido = v;
  }
  // q171 — aceita roteador próprio
  if (answers.q171) {
    const propMap: Record<string, 'sim' | 'sim_com_config_nossa' | 'nao_homologado_apenas' | 'nao'> = {
      'Sim — qualquer roteador': 'sim',
      'Sim — desde que nosso técnico configure': 'sim_com_config_nossa',
      'Apenas modelos homologados pela operação': 'nao_homologado_apenas',
      'Não — só aceitamos o nosso': 'nao',
    };
    const v = propMap[answers.q171];
    if (v) (br as any).aceitaRoteadorProprio = v;
  }

  // ─── FAQ: Combo ──────────────────────────────────────────────────────────
  if (answers.q169 && typeof answers.q169 === 'string' && answers.q169.trim()) {
    (br as any).ofereceCombo = String(answers.q169).trim();
  }

  // D1 — NPS coleta
  if (answers.q153) {
    const escalaMap: Record<string, 5 | 10> = {
      'Sim, escala 1-10': 10,
      'Sim, escala 1-5': 5,
    };
    const escala = escalaMap[answers.q153];
    if (escala) {
      (br as any).npsColeta = {
        enabled: true,
        automatico: true,
        escala,
        delayHoras: 1,
      };
    } else if (answers.q153 === 'Só manual') {
      (br as any).npsColeta = { enabled: true, automatico: false, escala: 10, delayHoras: 1 };
    } else if (answers.q153 === 'Não coleta') {
      (br as any).npsColeta = { enabled: false, automatico: false, escala: 10, delayHoras: 1 };
    }
  }

  // D2 — NPS nota baixa
  if (answers.q154) {
    const baixoMap: Record<string, 'escalar' | 'alertar' | 'registrar'> = {
      'Escalar pro humano imediatamente': 'escalar',
      'Gerar alerta no admin sem escalar': 'alertar',
      'Só registrar': 'registrar',
    };
    (br as any).npsBaixoAcao = baixoMap[answers.q154];
  }

  // D3 — NPS nota alta
  if (answers.q155) {
    const altoMap: Record<string, 'google' | 'indicacao' | 'nada'> = {
      'Pedir review no Google (com link)': 'google',
      'Pedir indicação de amigo': 'indicacao',
      'Nada automatizado': 'nada',
    };
    (br as any).npsAltoAcao = altoMap[answers.q155];
  }
  if (answers.q155b) (br as any).googleReviewLink = String(answers.q155b);

  // E1 — Assinatura final
  if (answers.q156) (br as any).assinaturaFinal = String(answers.q156);

  // E2 — Dados que o bot NUNCA envia
  if (answers.q157 && Array.isArray(answers.q157)) (br as any).dadosNuncaEnviar = answers.q157 as string[];

  // F16 — Política de mudança de data de vencimento
  if (answers.q160) {
    const freqMap: Record<string, 'ilimitado' | 'anual' | 'unico_contrato' | 'nao_permite'> = {
      'Sim — sem limite de vezes': 'ilimitado',
      'Sim — 1 vez por ano': 'anual',
      'Sim — 1 vez por contrato (permanente)': 'unico_contrato',
      'Não permite': 'nao_permite',
    };
    const freq = freqMap[answers.q160];
    const taxaTexto = answers.q161 === 'Com taxa (preencher abaixo)' && answers.q161_detail
      ? String(answers.q161_detail)
      : (answers.q161 === 'Sem taxa' ? null : undefined);
    const vigenciaMap: Record<string, 'proximo_ciclo' | 'ciclo_seguinte' | 'imediato'> = {
      'No próximo ciclo (próxima fatura)': 'proximo_ciclo',
      'No ciclo seguinte após a solicitação (2 meses depois)': 'ciclo_seguinte',
      'Imediato — ajusta a fatura atual': 'imediato',
    };
    const executorMap: Record<string, 'humano' | 'agente' | 'financeiro_confirmacao'> = {
      'Apenas humano (agente coleta pedido e escala)': 'humano',
      'Agente pode iniciar via API/automação': 'agente',
      'Equipe Financeira após confirmação por escrito do cliente': 'financeiro_confirmacao',
    };
    const diasDisponiveis = answers.q164
      ? String(answers.q164).split(/[,;\s]+/).map(s => parseInt(s)).filter(n => !isNaN(n) && n >= 1 && n <= 31)
      : [];
    (br as any).mudancaVencimento = {
      permitido: freq !== 'nao_permite' && freq !== undefined,
      frequencia: freq,
      taxa: taxaTexto,
      vigencia: answers.q162 ? vigenciaMap[answers.q162] : undefined,
      executor: answers.q163 ? executorMap[answers.q163] : undefined,
      diasDisponiveis,
    };
  }

  // F2 — máximo de dias de pausa (Bruno 2026-06-02). Fonte: q33e (estruturado,
  // número) com fallback parseando o q33 free-text ("máximo 90 dias"). Alimenta
  // businessRules.limits.pausaMaxDias, que o handleF2 usa pra validar o período
  // pedido. Sem nenhum dos dois → handler usa o default (90).
  {
    let pausaMaxDias: number | null = null;
    if (answers.q33e) {
      const n = parseInt(String(answers.q33e).replace(/\D/g, ''), 10);
      if (n >= 1 && n <= 365) pausaMaxDias = n;
    }
    if (pausaMaxDias === null && answers.q33) {
      const q33txt = String(answers.q33).toLowerCase();
      const m = q33txt.match(/m[áa]x(?:imo)?\.?\s*(?:de\s+)?(\d{1,3})/)
        || q33txt.match(/at[ée]\s+(\d{1,3})\s*dias?/);
      if (m) {
        const n = parseInt(m[1]!, 10);
        if (n >= 1 && n <= 365) pausaMaxDias = n;
      }
    }
    if (pausaMaxDias !== null) {
      (br as any).limits = { ...((br as any).limits ?? {}), pausaMaxDias };
    }
  }

  if (answers.q67 && Array.isArray(answers.q67)) br.retencaoOfertas = answers.q67 as string[];
  if (answers.q68 === 'Sim' && answers.q68_detail) br.retencaoDescontoMax = String(answers.q68_detail);
  if (answers.q69) br.retencaoDowngrade = String(answers.q69);
  if (answers.q70) {
    // q70 agora é radio. "Escalar humano antes de aceitar" = 0 tentativas (escala imediato).
    // As demais opções ("N ofertas recusadas") extraem o N via regex.
    if (answers.q70 === 'Escalar humano antes de aceitar') {
      br.retencaoTentativas = 0;
    } else {
      const m = String(answers.q70).match(/\d+/);
      if (m) br.retencaoTentativas = parseInt(m[0]);
    }
  }
  if (answers.q71 && Array.isArray(answers.q71)) br.retencaoSemRetencao = answers.q71 as string[];
  if (answers.q72) br.retencaoEstrategia = String(answers.q72);

  if (answers.q115) {
    const processoMap: Record<string, 'agente_processa' | 'agente_encaminha' | 'escalar_humano'> = {
      'Agente coleta dados do novo titular e processa via API': 'agente_processa',
      'Agente coleta dados e encaminha para equipe comercial finalizar': 'agente_encaminha',
      'Apenas humano pode processar — agente informa requisitos e escala': 'escalar_humano',
    };
    br.c7Processo = processoMap[answers.q115];
  }

  // Bruno 2026-05-13: q116/c9Processo descontinuada. C9 do agente é sempre
  // "coleta de novo endereço + handoff humano" (ver comercialAgent.ts L876).
  // Bloco removido — respostas antigas no banco ficam mas não têm efeito.

  const contextLines: string[] = [];

  if (answers.q1) contextLines.push(`NOME_AGENTE: ${answers.q1}`);

  if (answers.q2) {
    const tomMap: Record<string, string> = {
      'Formal — linguagem profissional e técnica': 'formal',
      'Neutro — equilibrado conforme o contexto': 'neutro',
      'Informal — linguagem próxima e descontraída': 'informal',
    };
    contextLines.push(`TOM_COMUNICACAO: ${tomMap[answers.q2] || answers.q2}`);
  }

  if (answers.q3) {
    const emojiMap: Record<string, string> = {
      'Sim — livre para usar': 'livre',
      'Sim — apenas emojis neutros/positivos': 'neutros_apenas',
      'Não — sem emojis': 'proibido',
    };
    contextLines.push(`EMOJIS: ${emojiMap[answers.q3] || answers.q3}`);
  }

  if (answers.q4) {
    const estiloMap: Record<string, string> = {
      'Direto — responde rápido e objetivo': 'direto',
      'Consultivo — explica antes de agir, orienta o cliente': 'consultivo',
      'Adapta conforme a situação': 'adaptativo',
    };
    contextLines.push(`ESTILO_RESPOSTA: ${estiloMap[answers.q4] || answers.q4}`);
  }

  if (answers.q5) contextLines.push(`IDENTIDADE_IA: ${answers.q5}`);
  if (answers.q6) contextLines.push(`SAUDACAO_INICIAL: ${answers.q6}`);
  if (answers.q7) contextLines.push(`PALAVRAS_PROIBIDAS: ${answers.q7}`);
  if (answers.q8) contextLines.push(`ASSUNTOS_PROIBIDOS: ${answers.q8}`);

  if (answers.q14) {
    const m = String(answers.q14).match(/\d+/);
    if (m) (br as any).ambiguityRetriesMax = Math.max(1, parseInt(m[0], 10));
  }

  // q9/q10 — Limites da camada conversacional (smalltalk).
  // q9 controla após quantas mensagens off-topic seguidas o agente "assume firme".
  // q10 controla após quantas ocorrências inadequadas escala pra humano.
  if (answers.q9 || answers.q10) {
    const smalltalk = { ...((br as any).smalltalk || {}) } as { enabled?: boolean; consecutiveLimit?: number; harassmentLimit?: number };
    smalltalk.enabled = smalltalk.enabled ?? true;
    if (answers.q9) {
      const m = String(answers.q9).match(/\d+/);
      if (m) smalltalk.consecutiveLimit = Math.max(1, parseInt(m[0], 10));
    }
    if (answers.q10) {
      const m = String(answers.q10).match(/\d+/);
      if (m) smalltalk.harassmentLimit = Math.max(1, parseInt(m[0], 10));
    }
    (br as any).smalltalk = smalltalk;
  }

  if (answers.q15) {
    const canalMap: Record<string, 'supervisor_whatsapp' | 'grupo_interno' | 'fila_erp' | 'outro'> = {
      'WhatsApp do supervisor / fila interna': 'supervisor_whatsapp',
      'Grupo interno (WhatsApp/Telegram)': 'grupo_interno',
      'Fila no ERP': 'fila_erp',
      'Outro': 'outro',
    };
    const canal = canalMap[answers.q15];
    if (canal) (br as any).canalEscalonacao = canal;
  }

  if (answers.q18) {
    const equipeMap: Record<string, 'sim_separado' | 'nao_unica' | 'sim_parcial'> = {
      'Sim — Financeiro, Suporte e Comercial separados': 'sim_separado',
      'Não — equipe única atende tudo': 'nao_unica',
      'Sim — parte separada': 'sim_parcial',
    };
    const estrutura = equipeMap[answers.q18];
    if (estrutura) (br as any).equipeDividaPorSetor = estrutura;
  }

  if (answers.q12) contextLines.push(`FORA_HORARIO: ${answers.q12}`);
  if (answers.q13 === 'Sim' && answers.q13_detail) {
    contextLines.push(`CANAL_EMERGENCIA: ${answers.q13_detail}`);
    sh.emergencyChannel = String(answers.q13_detail);
  }

  if (answers.q16a) {
    const behaviorMap: Record<string, 'closed' | 'open' | 'emergency'> = {
      'Sim — atende como dia normal': 'open',
      'Não — aplica a mesma regra de fora do expediente': 'closed',
      'Apenas canal de emergência': 'emergency',
    };
    const behavior = behaviorMap[answers.q16a];
    if (behavior) {
      sh.holidayBehavior = behavior;
      contextLines.push(`FERIADO_COMPORTAMENTO: ${behavior}`);
    }
  }
  // q16b agora é checkbox (feriados nacionais pré-preenchidos) + q16b_detail (textarea com outros).
  // Extrai "DD/MM" dos labels da checkbox e mescla com datas parseadas do textarea.
  // Opções não-datáveis (ex: "Carnaval (segunda e terça)", "Corpus Christi") viram contextLines
  // textuais — o agente pode ler do contexto que há exceção em datas móveis.
  if (answers.q16b || answers.q16b_detail) {
    const datasFixas: string[] = [];
    const datasMoveis: string[] = [];
    if (Array.isArray(answers.q16b)) {
      for (const opt of answers.q16b as string[]) {
        const m = opt.match(/^(\d{2})\/(\d{2})/);
        if (m) {
          datasFixas.push(`${m[2]}-${m[1]}`); // formato "MM-DD" (sem ano = toda ano)
        } else {
          datasMoveis.push(opt); // "Carnaval", "Corpus Christi", "Sexta-feira Santa"
        }
      }
    }
    const outrasDatas = answers.q16b_detail ? parseHolidayLines(String(answers.q16b_detail)) : [];
    const todosFeriados = Array.from(new Set([...datasFixas, ...outrasDatas]));
    if (todosFeriados.length > 0) {
      sh.holidays = todosFeriados;
      contextLines.push(`FERIADOS: ${todosFeriados.join(', ')}`);
    }
    if (datasMoveis.length > 0) {
      contextLines.push(`FERIADOS_MOVEIS: ${datasMoveis.join(', ')}`);
    }
  }

  if (answers.q14) contextLines.push(`TENTATIVAS_ANTES_ESCALAR: ${answers.q14}`);
  if (answers.q16) contextLines.push(`MENSAGEM_ESPERA: ${answers.q16}`);
  if (answers.q15) contextLines.push(`CANAL_ESCALONAMENTO: ${answers.q15}`);
  if (answers.q17) contextLines.push(`TEMPO_RESPOSTA_HUMANA: ${answers.q17}`);
  if (answers.q18) contextLines.push(`ESTRUTURA_EQUIPE: ${answers.q18}`);
  if (answers.q19) contextLines.push(`INFO_REPASSAR_HUMANO: ${answers.q19}`);

  // q25 agora é radio com opções pré-definidas + q25_detail pra "Outra regra".
  if (answers.q25) {
    const regra = answers.q25 === 'Outra regra (detalhar abaixo)' && answers.q25_detail
      ? String(answers.q25_detail)
      : String(answers.q25);
    contextLines.push(`REGRA_BLOQUEIO: ${regra}`);
  }
  if (answers.q27) contextLines.push(`DIAS_DESBLOQUEIO_PROMESSA: ${answers.q27}`);
  if (answers.q28) contextLines.push(`MAX_PROMESSAS_MES: ${answers.q28}`);
  if (answers.q29 === 'Sim' && answers.q29_detail) contextLines.push(`INTERVALO_MIN_PROMESSAS: ${answers.q29_detail}`);
  if (answers.q30) contextLines.push(`DESBLOQUEIO_APOS_PROMESSA: ${answers.q30}`);
  if (answers.q31) contextLines.push(`APOS_NAO_PAGAR_PROMESSA: ${answers.q31}`);

  // q37/q38/q39 removidos em 2026-04-23 — consolidados em q136/q138/q137 (ver Questionário v2).

  if (answers.q48) contextLines.push(`TOM_COBRANCA: ${answers.q48}`);

  if (answers.q50) contextLines.push(`VALIDACAO_COBERTURA: ${answers.q50}`);
  if (answers.q51) contextLines.push(`FORA_COBERTURA: ${answers.q51}`);
  if (answers.q54 === 'Sim' && answers.q54_detail) contextLines.push(`TAXA_INSTALACAO: ${answers.q54_detail}`);
  if (answers.q57) contextLines.push(`ANTECEDENCIA_AGENDAMENTO: ${answers.q57}`);

  if (answers.q59) contextLines.push(`FIDELIDADE: ${answers.q59}`);
  if (answers.q59_detail) contextLines.push(`PERIODO_FIDELIDADE: ${answers.q59_detail}`);
  if (answers.q60) contextLines.push(`MULTA_CANCELAMENTO: ${answers.q60}`);
  if (answers.q62) contextLines.push(`COBRANCA_MIGRACAO: ${answers.q62}`);
  if (answers.q64) contextLines.push(`DEBITO_MIGRACAO: ${answers.q64}`);

  if (answers.c11a) contextLines.push(`CHECKLIST_CONTRATACAO: ${(answers.c11a as string[]).join(', ')}`);
  if (answers.c11b) contextLines.push(`MODO_COLETA_DADOS: ${answers.c11b}`);
  if (answers.c11d) contextLines.push(`CAMPOS_OBRIGATORIOS_AGENDAMENTO: ${answers.c11d}`);
  if (answers.c11e) contextLines.push(`RESPONSAVEL_COLETA: ${answers.c11e}`);
  if (answers.c11f) contextLines.push(`APOS_COLETA_DADOS: ${answers.c11f}`);
  if (answers.c11g) contextLines.push(`ORDEM_COLETA: ${answers.c11g}`);

  if (answers.q65 === 'Sim' && answers.q65_detail) contextLines.push(`PROGRAMA_INDICACAO: ${answers.q65_detail}`);

  if (answers.q66) contextLines.push(`MOTIVOS_CANCELAMENTO: ${answers.q66}`);
  if (answers.q67) contextLines.push(`OFERTAS_RETENCAO: ${(answers.q67 as string[]).join(', ')}`);
  if (answers.q68 === 'Sim' && answers.q68_detail) contextLines.push(`DESCONTO_RETENCAO: ${answers.q68_detail}`);
  if (answers.q70) contextLines.push(`TENTATIVAS_RETENCAO: ${answers.q70}`);
  if (answers.q71) contextLines.push(`ACEITAR_CANCELAMENTO_SEM_RETER: ${(answers.q71 as string[]).join(', ')}`);
  if (answers.q72) contextLines.push(`ESTRATEGIA_RETENCAO: ${answers.q72}`);

  if (answers.q76) contextLines.push(`TOLERANCIA_VELOCIDADE: ${answers.q76}`);
  if (answers.q77) contextLines.push(`FERRAMENTA_SPEEDTEST: ${answers.q77}`);
  if (answers.q78) contextLines.push(`TESTE_VELOCIDADE_VIA: ${answers.q78}`);
  if (answers.q82) contextLines.push(`SLA_EMERGENCIA: ${answers.q82}`);
  if (answers.q83) contextLines.push(`SLA_COMUM: ${answers.q83}`);
  // q87/q88 removidos em 2026-04-23 — consolidados em q144/q145 (arrays estruturados).
  if (answers.q89) contextLines.push(`GARANTIA_EQUIPAMENTOS: ${answers.q89}`);
  if (answers.q92) contextLines.push(`LUZES_EQUIPAMENTO: ${answers.q92}`);

  if (answers.q53) contextLines.push(`DOCS_INSTALACAO: ${(answers.q53 as string[]).join(', ')}`);

  if (answers.q110) contextLines.push(`PRECO_ALTO_ACAO: ${answers.q110}`);

  if (answers.q111) contextLines.push(`LENTIDAO_HORARIOS_ACAO: ${answers.q111}`);
  if (answers.q112) contextLines.push(`WIFI_SUMIU_ACAO: ${answers.q112}`);
  if (answers.q114) contextLines.push(`CONSULTA_PLANO_AGENTE: ${answers.q114}`);
  if (answers.q118) contextLines.push(`ORIENTACAO_ROTEADOR_OFFLINE: ${answers.q118}`);

  if (answers.q115) contextLines.push(`TROCA_TITULARIDADE_PROCESSO: ${answers.q115}`);
  if (answers.q115b) contextLines.push(`DOCS_TROCA_TITULARIDADE: ${(answers.q115b as string[]).join(', ')}`);

  // q116 descontinuada (Bruno 2026-05-13). q116b/q116c continuam — informam custo/prazo ao atendente humano.
  if (answers.q116b === 'Sim' && answers.q116b_detail) contextLines.push(`CUSTO_MUDANCA_ENDERECO: ${answers.q116b_detail}`);
  if (answers.q116c) contextLines.push(`PRAZO_MUDANCA_ENDERECO: ${answers.q116c}`);

  if (answers.q105) contextLines.push(`OBSERVACOES_ADICIONAIS: ${answers.q105}`);

  // ── Questionário v2 — contextLines pra injetar nos prompts dos agentes ──
  if (answers.q130) contextLines.push(`ACEITA_CARTAO_RECORRENTE: ${answers.q130}`);
  if (answers.q131) contextLines.push(`CARTAO_GATEWAY: ${answers.q131}`);
  if (answers.q132) contextLines.push(`EMITE_NFE: ${answers.q132}`);
  if (answers.q133) contextLines.push(`PRAZO_NFE: ${answers.q133}`);
  if (answers.q134) contextLines.push(`PRAZO_ANALISE_PAGAMENTO: ${answers.q134}`);
  if (answers.q135) contextLines.push(`REGRA_MULTA_PROPORCIONAL: ${answers.q135}`);
  if (answers.q136) contextLines.push(`PARCELAMENTO_DIVIDA_MAX: ${answers.q136}`);
  if (answers.q137) contextLines.push(`PARCELAMENTO_VALOR_MINIMO: ${answers.q137}`);
  if (answers.q138) contextLines.push(`DESCONTO_AVISTA_DIVIDA: ${answers.q138}`);
  if (answers.q139) contextLines.push(`CREDITO_CONTA_POLICY: ${answers.q139}`);
  if (answers.q140) contextLines.push(`DEBITO_RECUSADO_FLUXO: ${answers.q140}`);
  if (answers.q141) contextLines.push(`SEM_ENERGIA_POLICY: ${answers.q141}`);
  if (answers.q142) contextLines.push(`CANAL_AVISO_MANUTENCAO: ${answers.q142}`);
  if (answers.q143) contextLines.push(`LINK_AVISO_MANUTENCAO: ${answers.q143}`);
  if (answers.q144 && Array.isArray(answers.q144)) contextLines.push(`MODELOS_ONU: ${(answers.q144 as string[]).join(', ')}`);
  if (answers.q145 && Array.isArray(answers.q145)) contextLines.push(`MODELOS_ROTEADOR: ${(answers.q145 as string[]).join(', ')}`);
  if (answers.q146) contextLines.push(`OS_AUTOMATICA_HORARIO: ${answers.q146}`);
  if (answers.q147) contextLines.push(`PORTA_BLOQUEADA_POLICY: ${answers.q147}`);
  if (answers.q149) contextLines.push(`MUDANCA_ENDERECO_FIDELIDADE: ${answers.q149}`);
  if (answers.q150) contextLines.push(`MUDANCA_ENDERECO_TAXA: ${answers.q150}`);
  if (answers.q151) contextLines.push(`SPLIT_CONTA: ${answers.q151}`);
  // q152 removido — benefício agora vem de q65_detail (PROGRAMA_INDICACAO já cobre).
  if (answers.q153) contextLines.push(`NPS_COLETA: ${answers.q153}`);
  if (answers.q154) contextLines.push(`NPS_BAIXO_ACAO: ${answers.q154}`);
  if (answers.q155) contextLines.push(`NPS_ALTO_ACAO: ${answers.q155}`);
  if (answers.q155b) contextLines.push(`GOOGLE_REVIEW_LINK: ${answers.q155b}`);
  if (answers.q156) contextLines.push(`ASSINATURA_FINAL: ${answers.q156}`);
  if (answers.q157 && Array.isArray(answers.q157)) contextLines.push(`DADOS_NUNCA_ENVIAR: ${(answers.q157 as string[]).join(', ')}`);
  if (answers.q160) contextLines.push(`MUDANCA_VENCIMENTO_PERMITIDO: ${answers.q160}`);
  if (answers.q161) contextLines.push(`MUDANCA_VENCIMENTO_TAXA: ${answers.q161}${answers.q161_detail ? ' — ' + answers.q161_detail : ''}`);
  if (answers.q162) contextLines.push(`MUDANCA_VENCIMENTO_VIGENCIA: ${answers.q162}`);
  if (answers.q163) contextLines.push(`MUDANCA_VENCIMENTO_EXECUTOR: ${answers.q163}`);
  if (answers.q164) contextLines.push(`MUDANCA_VENCIMENTO_DIAS_DISPONIVEIS: ${answers.q164}`);

  // ─── F4/F5/F6 — Reativação, Compensação, Histórico, Contestação, Reembolso (q34-q45) ───
  // Antes só viravam contextLines; agora cada um vira chave estruturada em
  // businessRules pra IA usar diretamente.
  if (answers.q34) {
    const reativacaoMap: Record<string, 'automatica' | 'manual'> = {
      'Automática — ERP reativa sozinho': 'automatica',
      'Manual — técnico precisa acionar': 'manual',
    };
    const v = reativacaoMap[answers.q34];
    if (v) (br as any).reativacaoAposPagamento = v;
  }
  if (typeof answers.q35 === 'string' && answers.q35.trim()) {
    (br as any).prazoCompensacaoBancaria = answers.q35.trim();
  }
  if (answers.q36) {
    if (answers.q36 === 'Sim') (br as any).consultaPagamentosERPDisponivel = true;
    else if (typeof answers.q36 === 'string' && answers.q36.startsWith('Não')) (br as any).consultaPagamentosERPDisponivel = false;
  }
  if (answers.q40) {
    if (typeof answers.q40 === 'string' && answers.q40.startsWith('Sim')) (br as any).agenteAbreContestacao = 'sim';
    else if (typeof answers.q40 === 'string' && answers.q40.startsWith('Não')) (br as any).agenteAbreContestacao = 'nao';
  }
  if (typeof answers.q41 === 'string' && answers.q41.trim()) {
    (br as any).prazoAnaliseContestacao = answers.q41.trim();
  }
  if (answers.q42) {
    if (typeof answers.q42 === 'string' && answers.q42.startsWith('Sim')) (br as any).agenteInformaHistorico = true;
    else if (typeof answers.q42 === 'string' && answers.q42.startsWith('Não')) (br as any).agenteInformaHistorico = false;
  }
  if (answers.q43 && typeof answers.q43 === 'string') {
    const m = String(answers.q43).match(/\d+/);
    if (m) (br as any).mesesHistoricoExibir = parseInt(m[0], 10);
  }
  if (answers.q44) {
    if (typeof answers.q44 === 'string' && answers.q44.startsWith('Sim')) (br as any).agenteAutorizaReembolso = 'sim';
    else if (typeof answers.q44 === 'string' && answers.q44.startsWith('Não')) (br as any).agenteAutorizaReembolso = 'nao';
  }
  if (typeof answers.q45 === 'string' && answers.q45.trim()) {
    (br as any).valorMaxAutorizacaoReembolso = answers.q45.trim();
  }

  // ─── C1/C2 — Contrato, Instalação, Migração de plano (q52, q55-q57, q61, q63, q64) ───
  if (answers.q52) {
    const contratoMap: Record<string, 'digital' | 'presencial'> = {
      'Sim — envio digital com assinatura eletrônica': 'digital',
      'Não — contrato assinado presencialmente na instalação': 'presencial',
    };
    const v = contratoMap[answers.q52];
    if (v) (br as any).contratoViaWhatsApp = v;
  }
  if (answers.q55 && Array.isArray(answers.q55) && answers.q55.length > 0) {
    (br as any).janelasInstalacao = answers.q55 as string[];
  }
  if (answers.q56) {
    const fdsMap: Record<string, 'sim_sab' | 'sim_sab_dom' | 'nao'> = {
      'Sim — sábado': 'sim_sab',
      'Sim — sábado e domingo': 'sim_sab_dom',
      'Não — apenas dias úteis': 'nao',
    };
    const v = fdsMap[answers.q56];
    if (v) (br as any).instalacaoFimDeSemana = v;
  }
  if (typeof answers.q57 === 'string' && answers.q57.trim()) {
    (br as any).antecedenciaMinimaInstalacao = answers.q57.trim();
  }
  if (answers.q61 === 'Sim' || answers.q61 === 'Não') {
    (br as any).carenciaMudancaPlano = {
      permite: answers.q61 === 'Sim',
      prazo: answers.q61 === 'Sim' && typeof answers.q61_detail === 'string' && answers.q61_detail.trim()
        ? answers.q61_detail.trim()
        : undefined,
    };
  }
  if (answers.q63 === 'Sim' || answers.q63 === 'Não') {
    (br as any).custoMigracaoPlano = {
      temCusto: answers.q63 === 'Sim',
      valor: answers.q63 === 'Sim' && typeof answers.q63_detail === 'string' && answers.q63_detail.trim()
        ? answers.q63_detail.trim()
        : undefined,
    };
  }
  if (answers.q64) {
    const migMap: Record<string, 'sim' | 'apenas_upgrade' | 'nao'> = {
      'Sim': 'sim',
      'Apenas upgrade — downgrade bloqueado': 'apenas_upgrade',
      'Não — precisa regularizar primeiro': 'nao',
    };
    const v = migMap[answers.q64];
    if (v) (br as any).migracaoComDebito = v;
  }

  return {
    businessRules: br,
    serviceHours: sh,
    questionnaire: {
      answers,
      completedAt: new Date().toISOString(),
      appliedAt: new Date().toISOString(),
    },
    questionnaireContext: contextLines.length > 0 ? contextLines.join('\n') : undefined,
  } as any;
}

export function registerTenantSettingsRoutes(app: Express) {
  app.get("/api/tenant-settings", requireAuth, async (req, res) => {
    try {
      const tenantId = req.user!.workspaceId;
      if (!tenantId) return res.status(400).json({ ok: false, error: "workspaceId ausente" });
      const settings = await tenantSettingsService.getTenantSettings(tenantId);
      res.json({ ok: true, data: settings });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: safeErr(e, "[tenant-settings]") });
    }
  });

  app.put("/api/tenant-settings", requireAuth, async (req, res) => {
    try {
      const tenantId = req.user!.workspaceId;
      if (!tenantId) return res.status(400).json({ ok: false, error: "workspaceId ausente" });
      const updated = await tenantSettingsService.updateTenantSettings(tenantId, req.body);
      res.json({ ok: true, data: updated });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: safeErr(e, "[tenant-settings]") });
    }
  });

  app.post("/api/tenant-settings/reset", requireAuth, async (req, res) => {
    try {
      const tenantId = req.user!.workspaceId;
      if (!tenantId) return res.status(400).json({ ok: false, error: "workspaceId ausente" });
      const defaults = await tenantSettingsService.resetTenantSettings(tenantId);
      res.json({ ok: true, data: defaults });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: safeErr(e, "[tenant-settings]") });
    }
  });

  app.post("/api/tenant-settings/apply-questionnaire", requireAuth, async (req, res) => {
    try {
      const tenantId = req.user!.workspaceId;
      if (!tenantId) return res.status(400).json({ ok: false, error: "workspaceId ausente" });

      const { answers } = req.body;
      if (!answers || typeof answers !== 'object') {
        return res.status(400).json({ ok: false, error: "answers é obrigatório" });
      }

      const current = await tenantSettingsService.getTenantSettings(tenantId);

      const backup: TenantSettingsJson['questionnaireRulesBackup'] = {
        businessRules: JSON.parse(JSON.stringify(current.businessRules)),
        serviceHours: JSON.parse(JSON.stringify(current.serviceHours)),
        savedAt: new Date().toISOString(),
      };

      const mapped = mapQuestionnaireToRules(answers, current);
      const updated = await tenantSettingsService.updateTenantSettings(tenantId, {
        ...mapped,
        questionnaireRulesBackup: backup,
      });

      console.log(`[Questionnaire] Rules applied for tenant ${tenantId} — backup saved`);
      res.json({ ok: true, data: updated });
    } catch (e: any) {
      console.error(`[Questionnaire] Error applying rules:`, e);
      res.status(500).json({ ok: false, error: "Erro interno" });
    }
  });

  app.post("/api/tenant-settings/restore-questionnaire-backup", requireAuth, async (req, res) => {
    try {
      const tenantId = req.user!.workspaceId;
      if (!tenantId) return res.status(400).json({ ok: false, error: "workspaceId ausente" });

      const current = await tenantSettingsService.getTenantSettings(tenantId);
      const backup = current.questionnaireRulesBackup;
      if (!backup) {
        return res.status(400).json({ ok: false, error: "Nenhum backup disponível" });
      }

      const updated = await tenantSettingsService.updateTenantSettings(tenantId, {
        businessRules: backup.businessRules,
        questionnaireContext: '',
      });

      console.log(`[Questionnaire] Backup restored for tenant ${tenantId}`);
      res.json({ ok: true, data: updated });
    } catch (e: any) {
      console.error(`[Questionnaire] Error restoring backup:`, e);
      res.status(500).json({ ok: false, error: "Erro interno" });
    }
  });

  console.log("[Boot] Tenant Settings routes registered at /api/tenant-settings");
}
