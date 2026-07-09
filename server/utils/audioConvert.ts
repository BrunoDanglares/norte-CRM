// Conversão de áudio pra formato aceito pela Meta Cloud API.
//
// Bruno 2026-05-19: navegadores (Chrome/Edge desktop) gravam em
// `audio/mp4;codecs=opus` ou `audio/webm;codecs=opus`. Meta REJEITA mp4
// com opus (espera AAC dentro de mp4) e NÃO aceita webm. Os formatos aceitos
// pela Meta pra áudio são: audio/aac, audio/mp4(+aac), audio/mpeg, audio/amr,
// audio/ogg(+opus). Como navegadores produzem opus por padrão, o destino mais
// natural é `audio/ogg;codecs=opus` — só re-encapsula o stream sem re-encode.
//
// Caso real: log [AUDIO-DIAG-19/05] mostrou que cliente envia mp4+opus, Meta
// detecta o conteúdo como `application/octet-stream` e rejeita com 131053.

import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";

const FFMPEG_PATH = (ffmpegStatic as unknown as string) || "ffmpeg";

export interface ConvertedAudio {
  buffer: Buffer;
  mimeType: string;
  extension: string;
}

/**
 * Converte um buffer de áudio (qualquer formato suportado por ffmpeg) pra
 * AAC em container MP4 (m4a), formato universalmente aceito pela Meta Cloud
 * API pra `audio`.
 *
 * Bruno 2026-05-19: tentamos antes ogg/opus mas Meta rejeitou com "type is
 * application/octet-stream" mesmo o arquivo sendo ogg válido (parser strict
 * da Meta). AAC/MP4 é o formato que o próprio app WhatsApp usa pra voz e a
 * Meta aceita sem reclamação. Re-encode é barato (~30-100ms pra áudios curtos).
 *
 * Parâmetros: 64kbps AAC mono 16kHz — suficiente pra voz, arquivo leve. Usa
 * o flag `+faststart` pra mover o moov atom pro começo do arquivo (necessário
 * pra streaming/processamento server-side).
 */
export async function convertToOggOpus(inputBuffer: Buffer): Promise<ConvertedAudio> {
  return new Promise((resolve, reject) => {
    // Bruno 2026-05-19: AAC em ADTS — formato que CONFIRMADAMENTE Meta aceita
    // e o áudio chega no celular. Tentamos ogg/opus (que daria voice note real
    // do WhatsApp) mas a Meta rejeita com "type is application/octet-stream"
    // mesmo com flags voip — provavelmente porque o ffmpeg-static no Windows
    // gera headers ogg com diferenças sutis que o parser strict da Meta não
    // aceita. Tradeoff: AAC chega como "arquivo de áudio" no WhatsApp (não
    // como msg de voz nativa), mas entrega é garantida. Voice note real pode
    // ser revisto em ambiente Linux server (ffmpeg do apt pode gerar ogg
    // compatível) — pendente investigar.
    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-i", "pipe:0",              // entrada via stdin
      "-vn",                       // sem vídeo
      "-c:a", "aac",               // codec AAC (nativo no ffmpeg)
      "-b:a", "64k",               // 64kbps (voz com qualidade)
      "-ac", "1",                  // mono
      "-ar", "44100",              // 44.1kHz (sample rate seguro pra AAC)
      "-f", "adts",                // AAC raw com ADTS headers (stream-safe)
      "pipe:1",                    // saída via stdout
    ];

    const proc = spawn(FFMPEG_PATH, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    proc.stdout.on("data", (chunk: Buffer) => outChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));

    proc.on("error", (err: Error) => {
      reject(new Error(`ffmpeg spawn failed: ${err.message}`));
    });

    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        const errText = Buffer.concat(errChunks).toString("utf-8");
        reject(new Error(`ffmpeg exit ${code}: ${errText.slice(0, 500)}`));
        return;
      }
      const out = Buffer.concat(outChunks);
      if (out.length < 100) {
        reject(new Error(`ffmpeg output suspiciously small: ${out.length} bytes`));
        return;
      }
      resolve({
        buffer: out,
        mimeType: "audio/aac",
        extension: "aac",
      });
    });

    // Envia o input via stdin e fecha
    proc.stdin.on("error", () => { /* ignora EPIPE — ffmpeg encerra antes */ });
    proc.stdin.write(inputBuffer);
    proc.stdin.end();
  });
}

/**
 * Transcodifica um arquivo de áudio (qualquer formato — tipicamente OGG/Opus do
 * WhatsApp) pra MP3 (libmp3lame), arquivo→arquivo. Bruno 2026-06-05: WhatsApp
 * entrega voz em OGG/Opus, que Safari/iOS NÃO tocam no <audio>. O endpoint
 * /api/audio-compat usa isto pra gerar um .mp3 (universal) sob demanda e cachear
 * em disco. 64kbps mono 44.1kHz — leve, suficiente pra voz.
 */
export async function transcodeFileToMp3(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-i", inputPath,
      "-vn",
      "-c:a", "libmp3lame",
      "-b:a", "64k",
      "-ac", "1",
      "-ar", "44100",
      "-f", "mp3",
      "-y",
      outputPath,
    ];
    const proc = spawn(FFMPEG_PATH, args, { stdio: ["ignore", "ignore", "pipe"] });
    const errChunks: Buffer[] = [];
    proc.stderr.on("data", (c: Buffer) => errChunks.push(c));
    proc.on("error", (err: Error) => reject(new Error(`ffmpeg spawn failed: ${err.message}`)));
    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exit ${code}: ${Buffer.concat(errChunks).toString("utf-8").slice(0, 300)}`));
        return;
      }
      resolve();
    });
  });
}
