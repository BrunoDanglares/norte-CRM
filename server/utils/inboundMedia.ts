// Salva mídia recebida (inbound) em /uploads e devolve a URL local servível pelo
// nosso domínio. Cobre os 2 jeitos que um canal pode entregar a mídia:
//   (a) base64 inline no webhook (data URL "data:...;base64,XXX" OU raw base64)
//   (b) URL externa baixável (fetch)
// Usado pelo canal Evolution GO (webhook-evolution). O padrão de path espelha o
// avatarCache: /uploads/<sub>/<workspaceId>/<arquivo>.
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { uploadsDir } from "./uploadsDir";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "audio/ogg": "ogg", "audio/opus": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr", "audio/wav": "wav",
  "video/mp4": "mp4", "video/3gpp": "3gp", "video/quicktime": "mov",
  "application/pdf": "pdf",
};

function extFor(mime: string | null | undefined, fallback: string): string {
  if (!mime) return fallback;
  const m = mime.split(";")[0].trim().toLowerCase();
  return EXT_BY_MIME[m] || fallback;
}

export interface SaveInboundMediaInput {
  workspaceId: string;
  externalId: string;
  type: "image" | "audio" | "video" | "document";
  mime?: string | null;
  base64?: string | null;   // data URL OU raw base64
  url?: string | null;      // URL externa (fallback)
  filename?: string | null;
}

/**
 * Salva a mídia e retorna { url, mime } (url = /uploads/...). Retorna null se não
 * havia fonte utilizável (sem base64 e sem URL baixável) ou em caso de erro —
 * o caller cai no placeholder ("[imagem]" etc.).
 */
export async function saveInboundMedia(opts: SaveInboundMediaInput): Promise<{ url: string; mime: string } | null> {
  try {
    const fallbackExt = opts.type === "image" ? "jpg" : opts.type === "audio" ? "ogg" : opts.type === "video" ? "mp4" : "bin";
    let mime = (opts.mime || "").trim();
    let buf: Buffer | null = null;

    if (opts.base64 && opts.base64.length > 0) {
      let b64 = opts.base64.trim();
      const m = b64.match(/^data:([^;]+);base64,([\s\S]*)$/);
      if (m) { if (!mime) mime = m[1]; b64 = m[2]; }
      buf = Buffer.from(b64, "base64");
    } else if (opts.url && /^https?:\/\//i.test(opts.url)) {
      // Bruno 2026-06-18 (auditoria SSRF): bloqueia download de host interno/privado.
      const { assertSafeOutboundUrl } = await import("./ssrfGuard");
      assertSafeOutboundUrl(opts.url);
      const res = await fetch(opts.url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return null;
      if (!mime) mime = res.headers.get("content-type") || "";
      buf = Buffer.from(await res.arrayBuffer());
    }

    if (!buf || !buf.length) return null;
    if (buf.length > 25 * 1024 * 1024) { // 25MB — limite WhatsApp; defesa contra payload absurdo
      console.warn(`[inboundMedia] mídia ${opts.type} grande demais (${buf.length}B), ignorada`);
      return null;
    }

    const dir = path.join(uploadsDir, "evolution", opts.workspaceId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Extensão: mime mapeado tem prioridade; senão usa a extensão do NOME do
    // arquivo (ex: "Boleto.pdf" com mime genérico application/octet-stream →
    // salva .pdf, pra o leitor de comprovante PDF reconhecer pela URL .pdf).
    // Bruno 2026-06-19 (auditoria upload): o nameExt vem do CLIENTE (documento do
    // WhatsApp preserva o nome) — só aceita extensões de mídia conhecidas (allowlist),
    // senão cai no fallback por tipo. Impede plantar .html/.svg/.js no /uploads.
    const SAFE_NAME_EXTS = new Set(Object.values(EXT_BY_MIME).concat(["jpeg", "3gp", "m4a"]));
    const nameExt = (opts.filename || "").split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
    const safeNameExt = SAFE_NAME_EXTS.has(nameExt) ? nameExt : "";
    const ext = extFor(mime, safeNameExt || fallbackExt);
    // Bruno 2026-06-18 (auditoria LGPD): nome com sufixo ALEATÓRIO. Antes usava só
    // o id da mensagem (estruturado/adivinhável) → comprovante bancário tinha URL
    // chutável. Mantém um prefixo curto do id (rastreio) + 20 hex aleatórios.
    const prefix = (opts.externalId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(-16) || String(Date.now());
    const safeId = `${prefix}_${randomBytes(10).toString("hex")}`;
    const filename = `${opts.type}_${safeId}.${ext}`;
    const localPath = path.join(dir, filename);
    await fs.promises.writeFile(localPath, buf);

    return { url: `/uploads/evolution/${opts.workspaceId}/${filename}`, mime: mime || `${opts.type}/*` };
  } catch (e: any) {
    console.error("[inboundMedia] saveInboundMedia erro:", e?.message || e);
    return null;
  }
}
