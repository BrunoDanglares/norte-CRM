// Botão oficial "Sign in with Google" (Google Identity Services). Carrega o
// script do Google sob demanda, inicializa com o client_id e devolve o ID token
// (credential) no callback — que o front manda pro /api/auth/google. Bruno 2026-06-15.
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    google?: any;
  }
}

const GIS_SRC = "https://accounts.google.com/gsi/client";
let gisPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("falha ao carregar Google")));
      if (window.google?.accounts?.id) resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("falha ao carregar Google"));
    document.head.appendChild(s);
  });
  return gisPromise;
}

export function GoogleSignInButton({
  clientId,
  onCredential,
  text = "continue_with",
}: {
  clientId: string;
  onCredential: (credential: string) => void;
  text?: "signin_with" | "signup_with" | "continue_with";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onCredential);
  cbRef.current = onCredential;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!clientId) return;
    loadGis()
      .then(() => {
        if (cancelled || !ref.current || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (resp: any) => {
            if (resp?.credential) cbRef.current(resp.credential);
          },
        });
        const width = Math.min(400, Math.max(240, ref.current.offsetWidth || 320));
        ref.current.innerHTML = "";
        window.google.accounts.id.renderButton(ref.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text,
          shape: "pill",
          logo_alignment: "center",
          width,
        });
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [clientId, text]);

  if (failed) {
    return (
      <p className="text-[11px] text-neutral-400 text-center">
        Não foi possível carregar o login do Google.
      </p>
    );
  }

  return <div ref={ref} className="flex justify-center min-h-[44px]" />;
}
