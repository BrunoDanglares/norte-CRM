// Não baixar o Chromium bundled do puppeteer no `npm install`. Em produção (Nixpacks)
// usamos o Chromium do sistema (apt → /usr/bin/chromium; ver nixpacks.toml) e o download
// do bundled quebrava o build. O binário é resolvido em runtime por siteRenderer.acharChromium.
// Bruno 2026-07-10.
module.exports = { skipDownload: true };
