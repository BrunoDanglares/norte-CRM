import path from "path";
import fs from "fs";

// Fonte ÚNICA do diretório de mídia (uploads). Centraliza serving (routes.ts) e
// gravação (meta-whatsapp, evolution, instagram, avatares, painel) pra que
// NUNCA divirjam — se um writer grava num path e o serving lê de outro, a imagem
// vira "Imagem indisponível".
//
// Bruno 2026-06-02: imagens sumiam após CADA deploy porque /app/uploads é efêmero
// no container (sem volume) — recriado a cada redeploy do EasyPanel. O fix real é
// montar um VOLUME PERSISTENTE em /app/uploads (Dockerfile declara o ponto; o
// EasyPanel precisa anexar o volume). UPLOAD_DIR permite apontar pra outro mount,
// se um dia for preciso; default mantém o comportamento atual (CWD/uploads).
//
// Módulo-folha de propósito: só depende de path/fs (zero deps de app) pra poder
// ser importado por qualquer writer sem risco de ciclo de import.
export const uploadsDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(process.cwd(), "uploads");

try {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
} catch {
  // best-effort — se falhar aqui, o primeiro write recria.
}

// Resolve uma media_url "/uploads/..." pro caminho real EM DISCO, garantindo que
// fica dentro de uploadsDir. Bruno 2026-06-14 (auditoria): media_url vem do banco;
// um valor envenenado tipo "/uploads/../../etc/passwd" passaria no startsWith e o
// readFileSync leria fora do diretório de mídia (path traversal). Aqui a gente
// normaliza e BLOQUEIA qualquer caminho que escape de uploadsDir.
export function resolveUploadPath(mediaUrl: string): string {
  const rel = String(mediaUrl || "").replace(/^\/?uploads\/?/i, "");
  const resolved = path.resolve(uploadsDir, rel);
  const base = uploadsDir.endsWith(path.sep) ? uploadsDir : uploadsDir + path.sep;
  if (resolved !== uploadsDir && !resolved.startsWith(base)) {
    throw new Error("Caminho de mídia inválido (fora de uploads)");
  }
  return resolved;
}
