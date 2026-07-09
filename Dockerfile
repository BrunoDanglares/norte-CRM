FROM node:20-alpine
WORKDIR /app
# Bruno 2026-07-09: Instaflix renderiza sites em navegador headless (Puppeteer) pra ler
# o conteúdo REAL de sites SPA (preços/planos que só existem após o JS rodar). Em Alpine
# o Chromium bundled do puppeteer NÃO roda (musl libc) → usamos o do sistema (apk) e
# PULAMOS o download do bundled. As libs abaixo são as deps de runtime do Chromium.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
# O binário do pacote 'chromium' no Alpine atual é /usr/bin/chromium (no antigo era
# chromium-browser). O código (siteRenderer.acharChromium) detecta o path certo em runtime,
# então isto é só a dica preferencial. PUPPETEER_SKIP_DOWNLOAD pula o Chromium bundled (não roda no Alpine).
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 5000
ENV NODE_ENV=production
# Bruno 2026-06-02: mídia (imagens/áudios/comprovantes recebidos e enviados) é
# salva em /app/uploads. Sem volume persistente esse diretório é zerado a cada
# redeploy → imagens viram "Imagem indisponível". Declara o ponto de mount; no
# EasyPanel é PRECISO anexar um VOLUME PERSISTENTE a /app/uploads pra valer.
VOLUME ["/app/uploads"]
# Bruno 2026-06-20: liveness probe pro Swarm/EasyPanel REINICIAR um container
# "travado" (processo vivo mas event loop preso) — sem isto, o orquestrador só
# reage a processo MORTO, não a processo zumbi. /api/health é dependency-free
# (responde 200 enquanto o event loop roda; NÃO falha por DB fora) → não causa
# kill-loop. start-period generoso porque o boot faz auto-migrations/seed/restore
# e "pode demorar minutos" (ver CLAUDE.md). Usa wget do busybox (alpine).
HEALTHCHECK --interval=30s --timeout=5s --start-period=240s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-5000}/api/health" >/dev/null 2>&1 || exit 1
CMD ["node", "dist/index.cjs"]
