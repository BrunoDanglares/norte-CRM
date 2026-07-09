import { useEffect, useRef, useCallback, useState } from "react";
import { authService } from "../services/auth";

type WSEventHandler = (data: any) => void;

export function useWebSocket(handlers: Record<string, WSEventHandler>) {
  const wsRef = useRef<WebSocket | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const handlersRef = useRef(handlers);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const sseReconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const [connected, setConnected] = useState(false);
  const usingSSERef = useRef(false);
  const mountedRef = useRef(true);
  handlersRef.current = handlers;

  const dispatchEvent = useCallback((eventName: string, data: any) => {
    handlersRef.current[eventName]?.(data);
  }, []);

  const connectSSE = useCallback(() => {
    if (!mountedRef.current) return;
    const token = authService.getToken();
    if (!token) return;
    if (sseRef.current) return;

    usingSSERef.current = true;
    const sse = new EventSource(`/api/sse?token=${token}`);

    sse.onopen = () => {
      if (!mountedRef.current) { sse.close(); return; }
      setConnected(true);
    };

    sse.onmessage = (event) => {
      try {
        const { event: eventName, data } = JSON.parse(event.data);
        dispatchEvent(eventName, data);
      } catch {}
    };

    sse.onerror = () => {
      sse.close();
      sseRef.current = null;
      if (!mountedRef.current) return;
      setConnected(false);
      // Reconecta SSE com backoff de 3s
      clearTimeout(sseReconnectTimeoutRef.current);
      sseReconnectTimeoutRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        connectSSE();
      }, 3000);
    };

    sseRef.current = sse;
  }, [dispatchEvent]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    const token = authService.getToken();
    if (!token) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (usingSSERef.current) return;

    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${token}`);

    const wsTimeout = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        try { ws.close(); } catch {}
        connectSSE();
      }
    }, 4000);

    ws.onopen = () => {
      clearTimeout(wsTimeout);
      if (!mountedRef.current) { ws.close(); return; }
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const { event: eventName, data } = JSON.parse(event.data);
        dispatchEvent(eventName, data);
      } catch {}
    };

    ws.onclose = (e) => {
      clearTimeout(wsTimeout);
      if (!mountedRef.current) return;
      setConnected(false);
      wsRef.current = null;
      // código 1008 = auth rejeitado — não reconectar
      if (e.code !== 1008) {
        connectSSE();
      }
    };

    ws.onerror = () => {
      clearTimeout(wsTimeout);
      if (!mountedRef.current) return;
      setConnected(false);
    };

    wsRef.current = ws;
  }, [connectSSE, dispatchEvent]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    // Reconecta ao retornar de aba (se SSE também perdeu conexão)
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const wsOk = wsRef.current?.readyState === WebSocket.OPEN;
      const sseOk = !!sseRef.current;
      if (!wsOk && !sseOk) {
        // Tenta WS novamente (pode ter sido SSE-only antes)
        usingSSERef.current = false;
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(connect, 500);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibility);
      clearTimeout(reconnectTimeoutRef.current);
      clearTimeout(sseReconnectTimeoutRef.current);
      wsRef.current?.close();
      sseRef.current?.close();
      wsRef.current = null;
      sseRef.current = null;
    };
  }, [connect]);

  return { connected };
}
