import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import App from "./App";
import "./index.css";

// ── Modalidade de input (teclado × ponteiro) — controla QUANDO o anel de foco
// aparece. Resolve o "borda amarela a cada clique" pelo app inteiro: o anel de
// --ring (ouro oficial) vazava em TODO clique de mouse — o Radix restaura foco
// de forma programática ao fechar menus/popovers e o :focus-visible casava no
// ponteiro. Raiz: revelar o anel só quando a última interação foi TECLADO
// (heurística do focus-visible polyfill / WICG). O CSS (index.css) suprime o
// anel a menos que html[data-input-modality="keyboard"]. Fica no BUNDLE (não no
// /theme-init.js estático) porque aquele arquivo é cacheado e não tem HMR —
// aqui é hasheado e sempre fresco. Bruno 2026-06-20.
(function trackInputModality() {
  const de = document.documentElement;
  de.setAttribute("data-input-modality", "pointer");
  const set = (m: "keyboard" | "pointer") => {
    if (de.getAttribute("data-input-modality") !== m) {
      de.setAttribute("data-input-modality", m);
    }
  };
  window.addEventListener(
    "keydown",
    (e) => {
      // Combos de atalho (Ctrl/Alt/Meta) não são navegação de foco — ignora.
      if (e.metaKey || e.altKey || e.ctrlKey) return;
      set("keyboard");
    },
    true,
  );
  const toPointer = () => set("pointer");
  window.addEventListener("pointerdown", toPointer, true);
  window.addEventListener("mousedown", toPointer, true);
  window.addEventListener("touchstart", toPointer, true);
})();

createRoot(document.getElementById("root")!).render(<App />);
