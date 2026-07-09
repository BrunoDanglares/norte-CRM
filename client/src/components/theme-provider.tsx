import { useState, useEffect, createContext, useContext, useCallback } from "react";
import {
  applyColorPreset,
  DEFAULT_PRESET,
  type ColorPreset,
} from "@/lib/color-presets";

type Theme = "light" | "dark";

// Bruno 2026-06-18: tema único = banana (amarelo oficial), só light + dark.
// Removidas as paletas alternativas e o seletor de cor. Forçamos banana
// sempre, ignorando qualquer preset antigo salvo no localStorage (quem tinha
// escolhido lilás/azul/etc é resetado pro amarelo no próximo carregamento).
function readStoredPreset(): ColorPreset {
  return DEFAULT_PRESET;
}

function applyThemeToDOM(theme: Theme, preset: ColorPreset) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  // Redesign Norte: daisyUI usa data-theme no <html>. Sincronizamos com o modo
  // light/dark do CRM (branco = claro, preto = escuro — temas do ERP Nexus).
  root.setAttribute("data-theme", theme === "dark" ? "preto" : "branco");
  localStorage.setItem("theme", theme);
  applyColorPreset(preset, theme);
}

interface ThemeContextValue {
  theme: Theme;
  resolved: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
  colorPreset: ColorPreset;
  setColorPreset: (p: ColorPreset) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  resolved: "light",
  setTheme: () => {},
  toggle: () => {},
  colorPreset: DEFAULT_PRESET,
  setColorPreset: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [colorPreset, _setColorPreset] = useState<ColorPreset>(readStoredPreset);

  const [theme, _setTheme] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("theme") as Theme;
      const initial: Theme = stored === "dark" ? "dark" : "light";
      applyThemeToDOM(initial, readStoredPreset());
      return initial;
    }
    return "light";
  });

  const setTheme = useCallback((t: Theme) => {
    applyThemeToDOM(t, colorPreset);
    _setTheme(t);
  }, [colorPreset]);

  const toggle = useCallback(() => {
    _setTheme((prev) => {
      const next: Theme = prev === "light" ? "dark" : "light";
      applyThemeToDOM(next, colorPreset);
      return next;
    });
  }, [colorPreset]);

  const setColorPreset = useCallback((p: ColorPreset) => {
    _setColorPreset(p);
    applyColorPreset(p, theme);
  }, [theme]);

  return (
    <ThemeContext.Provider
      value={{ theme, resolved: theme, setTheme, toggle, colorPreset, setColorPreset }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
