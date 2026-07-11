# Build controlado por Dockerfile (o Nixpacks, na base Ubuntu, injeta um chromium SNAP ao
# detectar o puppeteer — e snap não roda em container). Aqui usamos Debian (bookworm), onde
# o pacote `chromium` do apt é um binário REAL. Node 22 (puppeteer 25/vite 7/sharp exigem >=22/20).
# Bruno 2026-07-11.
FROM node:22-bookworm-slim
WORKDIR /app

# Chromium REAL do Debian (não-snap) + libs de fonte pro Instaflix renderizar sites headless.
# O puppeteer NÃO baixa o bundled (PUPPETEER_SKIP_DOWNLOAD) — usa este, resolvido por
# PUPPETEER_EXECUTABLE_PATH / siteRenderer.acharChromium.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium ca-certificates fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build
EXPOSE 5000
ENV NODE_ENV=production

# Mídia (uploads) precisa de volume persistente no EasyPanel (senão zera a cada redeploy).
VOLUME ["/app/uploads"]

# Liveness probe (Node 22 tem fetch global; bookworm-slim não traz wget/curl).
HEALTHCHECK --interval=30s --timeout=5s --start-period=240s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.cjs"]
