import { type Express } from "express";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import fs from "fs";
import path from "path";

const BOOT_ID = Date.now().toString(36);

const viteLogger = createLogger();

export async function setupVite(server: Server, app: Express) {
  console.log("[Vite] setupVite: start");
  const serverOptions = {
    middlewareMode: true,
    hmr: false,
    allowedHosts: true as const,
    cors: true,
  };

  console.log("[Vite] calling createViteServer...");
  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        // Ignorar erros de porta WebSocket HMR (não fatal — HMR está desabilitado)
        if (msg.includes("Port") && msg.includes("already in use")) return;
        if (msg.includes("WebSocket server error")) return;
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });
  console.log("[Vite] createViteServer returned, registering middlewares...");

  app.use("/@vite/client", (req, res, next) => {
    const originalEnd = res.end;
    const chunks: Buffer[] = [];

    res.write = function (chunk: any) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    } as any;

    res.end = function (chunk: any, ...args: any[]) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      let body = Buffer.concat(chunks).toString("utf-8");
      body = body.replace(
        /reject\(\s*\/\*[^*]*\*\/\s*new Error\("WebSocket closed without opened\."\)\)/g,
        'resolve()'
      );
      body = body.replace(
        /console\.error\(`\[vite\] failed to connect to websocket[\s\S]*?`\)/g,
        'void 0'
      );
      body = body.replace(
        /await waitForSuccessfulPing\([^)]*\);/g,
        '/* ping disabled */;'
      );
      body = body.replace(
        /waitForSuccessfulPingInternal\([^)]*\)\.then\(/g,
        'Promise.resolve().then('
      );
      body = body.replace(
        /new WebSocket\([^)]*\)/g,
        '({addEventListener(){},removeEventListener(){},close(){},send(){},readyState:3,CONNECTING:0,OPEN:1,CLOSING:2,CLOSED:3})'
      );
      res.setHeader("Content-Length", Buffer.byteLength(body));
      return (originalEnd as any).call(res, body, ...(args as any[]));
    } as any;

    next();
  });

  app.use(vite.middlewares);

  console.log("[Vite] vite middlewares registered, registering catch-all...");
  app.use("/{*path}", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${BOOT_ID}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({
        "Content-Type": "text/html",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
  console.log("[Vite] setupVite: done");
}
