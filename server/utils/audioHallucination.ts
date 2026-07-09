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

  // Trigrama repetido 3+ vezes → "deixe eu ver" x3.
  if (maxNgramRepeat(words, 3) >= 3) return true;
  // Bigrama repetido 4+ vezes.
  if (maxNgramRepeat(words, 2) >= 4) return true;
  // Pouquíssimas palavras distintas em texto de tamanho razoável.
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
