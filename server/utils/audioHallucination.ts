// Detector de ALUCINAÇÃO do Whisper na transcrição de áudio.
//
// Contexto (Bruno 2026-06-15, conv prod Nekt): cliente mandou áudios que eram
// um bebê/criança balbuciando coisas desconexas (ruído, não-fala). O Whisper,
// quando recebe ruído/silêncio/balbucio, NÃO devolve vazio — ele "inventa"
// frases recorrentes do material de treino. As mais clássicas em PT-BR vêm de
// legendas de YouTube: "Se inscreve no canal e ative o sininho...", "Até a
// próxima!", "Obrigado por assistir", além de repetições em loop ("Deixe eu
// ver. Deixe eu ver. Deixe eu ver.") e despedidas repetidas ("Tchau, tchau.
// Tchau, tchau."). Esse texto fantasma vazava pro motor ISP e era roteado/
// respondido como se fosse uma mensagem real do cliente.
//
// Este detector roda DEPOIS da transcrição. Quando classifica como alucinação,
// o chamador descarta o texto (trata como áudio não compreendido) e cai no
// fallback gracioso já existente ("tive dificuldade pra ouvir, manda de novo ou
// digita").
//
// 3 camadas (qualquer uma positiva = alucinação):
//   1. Blocklist de frases de alta precisão (legenda/YouTube) — nunca aparecem
//      em fala real de cliente de provedor.
//   2. Repetição (n-gramas) — captura loops "Deixe eu ver. Deixe eu ver...".
//   3. Sinais acústicos do Whisper (verbose_json: no_speech_prob / avg_logprob /
//      compression_ratio) — captura ruído/não-fala genérico onde a frase não
//      está na blocklist. Só disponível no modelo whisper-1.

export interface WhisperSegmentSignal {
  text?: string;
  no_speech_prob?: number;
  avg_logprob?: number;
  compression_ratio?: number;
  start?: number;
  end?: number;
}

export interface WhisperSignals {
  segments?: WhisperSegmentSignal[];
  duration?: number;
}

export interface HallucinationVerdict {
  hallucinated: boolean;
  reason?: string;
}

// Normaliza pra comparação: minúsculas, sem acento, pontuação vira espaço.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,!?;:()\-"'…]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Frases que essencialmente NUNCA aparecem em fala genuína de cliente de ISP,
// mas são alucinações recorrentes do Whisper (legendas de vídeo/YouTube).
// Casadas sobre o texto normalizado (sem acento, minúsculo).
const BLOCKLIST: RegExp[] = [
  /se inscrev\w* no canal/,
  /inscrev\w*-?se no canal/,
  /ative o sininho/,
  /(deixe|deixa) (o |seu )?like/,
  /novos? videos?/,                       // "mais novos vídeos"
  /notificac\w+ dos? (mais )?novos/,
  /obrigad[oa] (por|pra) (assistir|ver o video|assistirem)/,
  /ate o proximo video/,
  /legendas? (pela|por|feitas? pela) comunidade/,
  /amara\.org/,
  /legendado por/,
  /\btchau\b[\s]+\btchau\b/,               // "tchau tchau" (despedida repetida)
];

// Conta a maior repetição de um n-grama (em nº de ocorrências).
function maxNgramRepeat(words: string[], n: number): number {
  if (words.length < n) return 0;
  const counts = new Map<string, number>();
  let max = 0;
  for (let i = 0; i + n <= words.length; i++) {
    const gram = words.slice(i, i + n).join(' ');
    const c = (counts.get(gram) ?? 0) + 1;
    counts.set(gram, c);
    if (c > max) max = c;
  }
  return max;
}

// Camada 2: repetição em loop (típico de balbucio/ruído transcrito).
function looksRepetitive(normText: string): boolean {
  const words = normText.split(' ').filter(Boolean);
  if (words.length < 4) return false;

  // Bruno 2026-07-16 (BUG DE FALSO POSITIVO): os limites eram ABSOLUTOS (trigrama
  // 3x, bigrama 4x). Foram calibrados pra alucinação CURTA — "deixe eu ver" x3,
  // onde a frase repetida É o texto inteiro. Em fala LONGA natural isso vira
  // armadilha: quanto mais o cliente fala, mais conectivo ele repete.
  // Caso real: áudio de 74s/189 palavras explicando o financeiro foi DESCARTADO
  // porque "se o cliente" apareceu 4x e "o boleto" 5x — português normal. O
  // cliente via "[áudio]" e o bot respondia "não consegui entender". Os 4 áudios
  // que falharam eram justamente os 4 MAIS LONGOS.
  //
  // O critério agora é COBERTURA, não contagem: alucinação é a mesma frase
  // DOMINANDO o texto. Contar repetição sem olhar o tamanho é sinal ruim.
  //   "deixe eu ver" x3 em 9 palavras   → cobre 100% → corta (como antes)
  //   "se o cliente" x5 em 130 palavras → cobre  11% → passa
  // Efeito colateral ACEITO: um loop curto no FIM de uma fala longa e real deixa
  // de ser cortado — e é o certo, porque descartar 100 palavras verdadeiras por
  // causa de um "obrigado obrigado" na cauda é pior do que manter o conteúdo.
  const cobertura = (n: number): number => {
    const rep = maxNgramRepeat(words, n);
    return rep >= 2 ? (n * rep) / words.length : 0;
  };
  const DOMINA = 0.5;
  if (cobertura(3) >= DOMINA) return true;
  if (cobertura(2) >= DOMINA) return true;
  if (cobertura(1) >= DOMINA) return true;
  // Pouquíssimas palavras distintas em texto de tamanho razoável. Esta continua
  // absoluta de propósito: pega o texto degenerado independente do tamanho.
  if (words.length >= 6) {
    const uniqRatio = new Set(words).size / words.length;
    if (uniqRatio <= 0.3) return true;
  }
  return false;
}

// Camada 3: sinais acústicos do Whisper (só whisper-1/verbose_json).
function looksLikeNonSpeech(signals?: WhisperSignals): boolean {
  const segs = signals?.segments;
  if (!segs || segs.length === 0) return false;

  // Qualquer segmento com compressão muito alta = texto repetitivo/degenerado.
  for (const s of segs) {
    if (typeof s.compression_ratio === 'number' && s.compression_ratio > 2.4) return true;
  }

  // Média (ponderada por duração) de no_speech_prob e avg_logprob.
  let totDur = 0, wNoSpeech = 0, wLogprob = 0, n = 0, sumLogprob = 0;
  for (const s of segs) {
    const dur = (typeof s.start === 'number' && typeof s.end === 'number' && s.end > s.start)
      ? (s.end - s.start) : 1;
    if (typeof s.no_speech_prob === 'number') { wNoSpeech += s.no_speech_prob * dur; totDur += dur; }
    if (typeof s.avg_logprob === 'number') { wLogprob += s.avg_logprob * dur; sumLogprob += s.avg_logprob; n++; }
  }
  const meanNoSpeech = totDur > 0 ? wNoSpeech / totDur : 0;
  const meanLogprob = totDur > 0 && wLogprob !== 0 ? wLogprob / totDur : (n > 0 ? sumLogprob / n : 0);

  // Não-fala provável: alta prob de "sem fala" + baixa confiança média.
  if (meanNoSpeech > 0.6 && meanLogprob < -0.7) return true;
  // Confiança muito baixa isolada (texto pouco confiável).
  if (n > 0 && meanLogprob < -1.0) return true;
  return false;
}

/**
 * Classifica um transcript do Whisper como alucinação (ou não).
 * @param rawText texto retornado pelo Whisper
 * @param signals sinais acústicos (verbose_json do whisper-1), opcional
 */
export function detectWhisperHallucination(rawText: string, signals?: WhisperSignals): HallucinationVerdict {
  const text = (rawText || '').trim();
  if (!text) return { hallucinated: false }; // vazio é tratado como "não compreendido" no chamador

  const norm = normalize(text);

  for (const re of BLOCKLIST) {
    if (re.test(norm)) return { hallucinated: true, reason: `blocklist:${re.source}` };
  }
  if (looksRepetitive(norm)) return { hallucinated: true, reason: 'repeticao' };
  if (looksLikeNonSpeech(signals)) return { hallucinated: true, reason: 'sinais_acusticos' };

  return { hallucinated: false };
}
