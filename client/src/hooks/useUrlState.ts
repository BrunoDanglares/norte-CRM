import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

// Sincroniza um estado da página com a query string da URL pra sobreviver ao F5.
// Uso: const [view, setView] = useUrlState<"ativos" | "encerrados">("view", "ativos");
export function useUrlState<T extends string>(
  key: string,
  defaultValue: T,
  allowed?: readonly T[],
): [T, (v: T) => void] {
  const [location, setLocation] = useLocation();

  const readFromUrl = useCallback((): T => {
    if (typeof window === "undefined") return defaultValue;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get(key);
    if (!raw) return defaultValue;
    if (allowed && !allowed.includes(raw as T)) return defaultValue;
    return raw as T;
  }, [key, defaultValue, allowed]);

  const [value, setValue] = useState<T>(readFromUrl);

  // Sincroniza quando o usuário usa back/forward (popstate via wouter)
  const lastLocationRef = useRef(location);
  useEffect(() => {
    if (lastLocationRef.current !== location) {
      lastLocationRef.current = location;
      setValue(readFromUrl());
    }
  }, [location, readFromUrl]);

  const update = useCallback((next: T) => {
    setValue(next);
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (next === defaultValue) params.delete(key);
    else params.set(key, next);
    const qs = params.toString();
    const path = window.location.pathname + (qs ? `?${qs}` : "");
    setLocation(path, { replace: true });
  }, [key, defaultValue, setLocation]);

  return [value, update];
}
