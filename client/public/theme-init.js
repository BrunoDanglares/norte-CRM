// Bootstrap de tema/preset ANTES do React montar (anti-FOUC). Extraído do inline
// de index.html (Auditoria 2026-06-19) pra permitir CSP enforce sem 'unsafe-inline':
// agora é um script externo de 'self', liberado por `script-src 'self'`.
(function () {
  var t = localStorage.getItem('theme') || 'dark';
  var resolved = t;
  if (t === 'system') {
    resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  if (resolved === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  // Redesign Norte: daisyUI usa data-theme (branco/preto). Setamos antes do React
  // pra não piscar o tema default no primeiro paint (mesma lógica do theme-provider).
  document.documentElement.setAttribute('data-theme', resolved === 'dark' ? 'preto' : 'branco');
  // Bruno 2026-05-21: bump pra nova versão quando adicionar nova var no preset.
  // Cache antigo sem a var nova ficava grudado depois de refresh.
  // 2026-07 (redesign Norte): 9 -> 10 (preset default trocado pra "norte").
  // 2026-07 (Bruno): 10 -> 11 (primária azul -> violeta; invalida cache azul).
  var CACHE_VER = '11';
  var cp = localStorage.getItem('colorPreset');
  if (cp) {
    try {
      var cachedVer = localStorage.getItem('colorPresetVersion');
      if (cachedVer === CACHE_VER) {
        var presetVars = localStorage.getItem('colorPresetVars');
        if (presetVars) {
          var vars = JSON.parse(presetVars);
          var root = document.documentElement;
          for (var key in vars) {
            root.style.setProperty(key, vars[key]);
          }
        }
      } else {
        // Cache stale — invalida pra forçar o React reaplicar do zero.
        localStorage.removeItem('colorPresetVars');
      }
    } catch (e) {}
  }
  // Personalização do Nexus (Rightbar): aplica tema estendido/fonte/direção ANTES
  // do React pra não piscar no reload. lib/nexus-config faz o mesmo em runtime.
  try {
    var root = document.documentElement;
    var DAISY = { light: 'branco', dark: 'preto', contrast: 'contrast', material: 'material', dim: 'dim', 'material-dark': 'material-dark' };
    var DARKISH = { dark: 1, dim: 1, 'material-dark': 1 };
    var nt = localStorage.getItem('nexus:theme');
    if (nt) {
      var eff = nt === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : nt;
      root.setAttribute('data-theme', DAISY[eff] || 'branco');
      if (DARKISH[eff]) root.classList.add('dark'); else root.classList.remove('dark');
      // Ponte pros tokens shadcn nos temas estendidos (evita flash preto/branco).
      var NEU = {
        contrast: { bg: '#f2f4f6', fg: '#1e2328', card: '#ffffff', b2: '#eef0f2', b3: '#dcdee0', m: '#6b7280' },
        material: { bg: '#fdfeff', fg: '#191e28', card: '#f6f8ff', b2: '#eaecfa', b3: '#e0e2f8', m: '#6b7280' },
        dim: { bg: '#222630', fg: '#f0f4f8', card: '#2a2e38', b2: '#343842', b3: '#3c404a', m: '#9aa4b0' },
        'material-dark': { bg: '#141618', fg: '#f0f4f8', card: '#181e24', b2: '#202830', b3: '#2c323a', m: '#9aa4b0' }
      };
      var n = NEU[eff];
      if (n) {
        var toHsl = function (hex) {
          var h2 = hex.replace('#', '');
          var r = parseInt(h2.slice(0, 2), 16) / 255, g = parseInt(h2.slice(2, 4), 16) / 255, b = parseInt(h2.slice(4, 6), 16) / 255;
          var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, hh = 0, s = 0, d = mx - mn;
          if (d !== 0) { s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); if (mx === r) hh = (g - b) / d + (g < b ? 6 : 0); else if (mx === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4; hh *= 60; }
          return Math.round(hh) + ' ' + Math.round(s * 100) + '% ' + Math.round(l * 100) + '%';
        };
        var M = { '--background': n.bg, '--foreground': n.fg, '--card': n.card, '--card-foreground': n.fg, '--card-border': n.b3, '--border': n.b3, '--input': n.b3, '--muted': n.b2, '--muted-foreground': n.m, '--secondary': n.b2, '--secondary-foreground': n.fg, '--accent': n.b2, '--accent-foreground': n.fg, '--popover': n.card, '--popover-foreground': n.fg, '--sidebar': n.card, '--sidebar-foreground': n.fg, '--sidebar-border': n.b3 };
        for (var mk in M) root.style.setProperty(mk, toHsl(M[mk]));
      }
    }
    var nf = localStorage.getItem('nexus:font');
    if (nf) root.setAttribute('data-font-family', nf);
    var nd = localStorage.getItem('nexus:dir');
    if (nd) root.setAttribute('dir', nd);
  } catch (e) {}

  // Fontes: o <link media="print"> baixa async; flip pra 'all' aqui em vez do
  // onload inline (que a CSP enforce bloquearia). Auditoria 2026-06-19.
  try {
    var fontLinks = document.querySelectorAll('link[rel="stylesheet"][media="print"]');
    for (var i = 0; i < fontLinks.length; i++) fontLinks[i].media = 'all';
  } catch (e) {}
})();
