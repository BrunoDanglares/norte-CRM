// Resolve o /api/audio-compat: dado um path /uploads/x.ogg, garante uma versão
// tocável em QUALQUER navegador (Safari/iOS não tocam OGG/Opus) e diz pra onde
// redirecionar. Transcodifica OGG→MP3 sob demanda + cacheia em disco.
// Bruno 2026-06-05. Extraído num util pra ser testável sem subir o servidor.
import * as fs from "fs";
import * as path from "path";
import { uploadsDir } from "./uploadsDir";
import { transcodeFileToMp3 } from "./audioConvert";

// Extensões que Safari/iOS já tocam — só redireciona pro original.
const SAFARI_OK = [".mp3", ".m4a", ".aac", ".wav", ".mp4"];

export interface AudioCompatResult {
  status: number;          // 302 (redirect), 400, 403, 404
  redirect?: string;       // URL pra Location quando 302
}

/**
 * @param u       URL relativa do áudio (precisa começar com /uploads/)
 * @param baseDir diretório raiz dos uploads (default uploadsDir — override p/ teste)
 */
export async function resolveAudioCompat(u: string, baseDir: string = uploadsDir): Promise<AudioCompatResult> {
  if (!u || !u.startsWith("/uploads/")) return { status: 400 };

  const root = path.resolve(baseDir);
  const srcPath = path.resolve(root, u.replace(/^\/uploads\//, ""));
  // Anti path-traversal: o arquivo resolvido tem que ficar DENTRO de uploads.
  if (srcPath !== root && !srcPath.startsWith(root + path.sep)) return { status: 403 };
  if (!fs.existsSync(srcPath)) return { status: 404 };

  const ext = path.extname(srcPath).toLowerCase();
  if (SAFARI_OK.includes(ext)) return { status: 302, redirect: u };

  // OGG/Opus/WebM/… → garante o .compat.mp3 cacheado e redireciona pra ele.
  const mp3Path = srcPath.replace(/\.[^.]+$/, "") + ".compat.mp3";
  // Bruno 2026-07-16 (BUG): era `path.basename(mp3Path)`, que JOGAVA FORA a
  // subpasta. Funcionava só pro áudio da Meta (salvo plano em /uploads/), mas
  // o do Evolution mora em /uploads/evolution/<workspaceId>/ — o redirect
  // apontava pra /uploads/<arquivo>.compat.mp3, que não existe → 404 → o player
  // ficava mudo em 0:00 em TODO áudio do Evolution. O mp3 sempre esteve certo
  // no disco; era o endereço que saía errado. Agora deriva o caminho RELATIVO
  // à raiz de uploads, preservando a subpasta.
  const mp3Url = "/uploads/" + path.relative(root, mp3Path).split(path.sep).join("/");
  if (!fs.existsSync(mp3Path)) {
    await transcodeFileToMp3(srcPath, mp3Path);
  }
  return { status: 302, redirect: mp3Url };
}
