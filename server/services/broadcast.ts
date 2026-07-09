import { WebSocket } from 'ws';
import type { Response } from 'express';

interface SSEClient {
  res: Response;
  workspaceId: string;
}

let wsClients: Map<string, Set<WebSocket>> = new Map();
let sseClients: Map<string, Set<SSEClient>> = new Map();

export function initBroadcast(
  ws: Map<string, Set<WebSocket>>,
  sse: Map<string, Set<SSEClient>>,
): void {
  wsClients = ws;
  sseClients = sse;
}

export function broadcastToWorkspace(workspaceId: string, event: string, data: object): void {
  const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });

  const wsSet = wsClients.get(workspaceId);
  if (wsSet?.size) {
    wsSet.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    });
  }

  const sseSet = sseClients.get(workspaceId);
  if (sseSet?.size) {
    sseSet.forEach((client) => {
      try { client.res.write(`data: ${payload}\n\n`); } catch {}
    });
  }
}
