import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Bruno 2026-06-05: cache correto pós-deploy. Os assets têm hash no nome
  // (/assets/index-XXXX.js) → imutáveis, cache eterno. MAS o index.html NÃO pode
  // ser cacheado: senão, após um deploy, o navegador serve o index.html velho
  // apontando pra chunks que não existem mais → tela quebrada (foi o que pegou a
  // equipe). Agora index.html sempre revalida.
  app.use(express.static(distPath, {
    etag: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-cache, must-revalidate");
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }));

  // fall through to index.html if the file doesn't exist (SPA) — nunca cacheia.
  app.use("/{*path}", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
