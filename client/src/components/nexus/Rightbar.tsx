// Drawer de Personalização — PORT FIEL do Rightbar do Nexus 4.0.0
// (admin-layout/Rightbar). Preview de cada tema via data-theme no card (cores
// reais), botões com destaque sutil bg-base-200, header com reset/fullscreen/
// fechar. Wireado ao motor lib/nexus-config + ThemeProvider.
import { useEffect, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import {
  applyNexusConfig,
  getNexusCfg,
  resetNexusConfig,
  setNexusCfg,
  type NexusTheme,
} from "@/lib/nexus-config";

// id = valor persistido; daisy = nome do tema daisyUI (pra o preview render nas
// cores reais via data-theme no card). Sistema não fixa tema no preview.
const THEMES: { id: NexusTheme; daisy?: string; label: string }[] = [
  { id: "light", daisy: "branco", label: "Luz" },
  { id: "contrast", daisy: "contrast", label: "Contraste" },
  { id: "material", daisy: "material", label: "Material" },
  { id: "dark", daisy: "preto", label: "Escuro" },
  { id: "dim", daisy: "dim", label: "Diminutivo" },
  { id: "material-dark", daisy: "material-dark", label: "Material Escuro" },
  { id: "system", label: "Sistema" },
];

const FONTS: { id: string; label: string }[] = [
  { id: "dm-sans", label: "DM Sans" },
  { id: "wix", label: "Wix" },
  { id: "inclusive", label: "Inclusivo" },
  { id: "ar-one", label: "AR One" },
];

function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  } catch {}
}

export function NexusRightbar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { setTheme } = useTheme();
  const [cfg, setCfg] = useState(() => getNexusCfg());

  useEffect(() => { applyNexusConfig(); }, []);
  useEffect(() => { if (open) setCfg(getNexusCfg()); }, [open]);
  const refresh = () => setCfg(getNexusCfg());

  const pickTheme = (id: NexusTheme) => {
    setNexusCfg("theme", id);
    if (id === "light") setTheme("light");
    else if (id === "dark") setTheme("dark");
    else if (id === "system") setTheme((window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light") as "light" | "dark");
    refresh();
  };
  const pickSidebar = (v: "light" | "dark") => { setNexusCfg("sidebar", cfg.sidebar === v ? "" : v); refresh(); };
  const pickFont = (v: string) => { setNexusCfg("font", v); refresh(); };
  const pickDir = (v: "ltr" | "rtl") => { setNexusCfg("dir", v); refresh(); };
  const reset = () => { resetNexusConfig(); setTheme("light"); refresh(); };

  // Sidebar override só faz sentido em temas claros (light/contraste), como no Nexus.
  const sidebarEnabled = cfg.theme === "light" || cfg.theme === "contrast";

  const btnBase = "border-base-300 hover:bg-base-200 rounded-box inline-flex cursor-pointer items-center justify-center gap-2 border p-2 text-[13px]";

  return (
    <>
      <div
        className={`fixed inset-0 z-[90] bg-black/40 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`fixed top-0 bottom-0 end-0 z-[91] w-76 sm:w-96 max-w-[90vw] bg-base-100 text-base-content border-s border-base-300 shadow-2xl flex flex-col transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full rtl:-translate-x-full"}`}
        aria-label="Personalização"
      >
        {/* Header */}
        <div className="bg-base-200/30 border-base-200 flex h-16 min-h-16 items-center justify-between border-b px-5 shrink-0">
          <p className="text-lg font-medium">Personalização</p>
          <div className="inline-flex gap-1">
            <button className="btn btn-ghost btn-sm btn-circle" onClick={reset} aria-label="Restaurar padrão">
              <span className="iconify lucide--rotate-cw size-5" />
            </button>
            <button className="btn btn-ghost btn-sm btn-circle" onClick={toggleFullscreen} aria-label="Tela cheia">
              <span className="iconify lucide--fullscreen size-5" />
            </button>
            <button className="btn btn-ghost btn-sm btn-circle" onClick={onClose} aria-label="Fechar">
              <span className="iconify lucide--x size-5" />
            </button>
          </div>
        </div>

        {/* Conteúdo */}
        <div className="grow overflow-auto p-4 sm:p-5">
          {/* Tema */}
          <p className="font-medium">Tema</p>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {THEMES.map((t) => {
              const active = cfg.theme === t.id;
              return (
                <div
                  key={t.id}
                  {...(t.daisy ? { "data-theme": t.daisy } : {})}
                  className="rounded-box group relative cursor-pointer"
                  onClick={() => pickTheme(t.id)}
                  data-testid={`theme-${t.id}`}
                >
                  <div className="bg-base-200 rounded-box pt-5 pb-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span className="rounded-box bg-primary h-6 w-2 sm:w-3" />
                      <span className="rounded-box bg-secondary h-6 w-2 sm:w-3" />
                      <span className="rounded-box bg-accent h-6 w-2 sm:w-3" />
                      <span className="rounded-box bg-success h-6 w-2 sm:w-3" />
                    </div>
                    <p className="mt-1.5 text-sm capitalize sm:text-[15px] leading-tight">{t.label}</p>
                  </div>
                  <span className={`bg-primary text-primary-content absolute inset-e-2 top-2 rounded-full transition-all ${active ? "p-1 opacity-100" : "p-0 opacity-0"}`} />
                </div>
              );
            })}
          </div>

          {/* Barra lateral (só em temas claros) */}
          <div className={sidebarEnabled ? "" : "pointer-events-none opacity-50"}>
            <p className="mt-6 font-medium">
              Barra lateral
              {!sidebarEnabled && <span className="ms-1 inline text-xs md:text-sm">(*Só em temas claros)</span>}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className={`${btnBase} ${cfg.sidebar === "light" ? "bg-base-200" : ""}`} onClick={() => sidebarEnabled && pickSidebar("light")} data-testid="sidebar-light">
                <span className="iconify lucide--sun size-4.5" /> Luz
              </div>
              <div className={`${btnBase} ${cfg.sidebar === "dark" ? "bg-base-200" : ""}`} onClick={() => sidebarEnabled && pickSidebar("dark")} data-testid="sidebar-dark">
                <span className="iconify lucide--moon size-4.5" /> Escuro
              </div>
            </div>
          </div>

          {/* Família de fontes */}
          <p className="mt-6 font-medium">Família de fontes</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {FONTS.map((f) => (
              <div key={f.id} className={`${btnBase} ${cfg.font === f.id ? "bg-base-200" : ""}`} onClick={() => pickFont(f.id)} data-testid={`font-${f.id}`}>
                <p data-font-family={f.id} className="font-sans">{f.label}</p>
              </div>
            ))}
          </div>

          {/* Direção */}
          <p className="mt-6 font-medium">Direção</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className={`${btnBase} ${cfg.dir === "ltr" ? "bg-base-200" : ""}`} onClick={() => pickDir("ltr")} data-testid="dir-ltr">
              <span className="iconify lucide--align-left size-4.5" />
              <span className="hidden sm:inline">Esquerda → Direita</span>
              <span className="inline sm:hidden">LTR</span>
            </div>
            <div className={`${btnBase} ${cfg.dir === "rtl" ? "bg-base-200" : ""}`} onClick={() => pickDir("rtl")} data-testid="dir-rtl">
              <span className="iconify lucide--align-right size-4.5" />
              <span className="hidden sm:inline">Direita → Esquerda</span>
              <span className="inline sm:hidden">RTL</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
