// WebSocket connection hook for real-time updates
// Per M8 design doc: ws://host/ws/experiments/:experimentId?token=jwt

import { useEffect, useRef, useCallback } from 'react';

type MessageHandler = (data: any) => void;

function getWsBase(): string {
  if (typeof window === 'undefined') return '';
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return protocol + '//' + window.location.host;
}

const WS_BASE = (typeof window !== 'undefined') ? getWsBase() : '';

export function useWebSocket(
  experimentId: string | undefined,
  onMessage: MessageHandler,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<NodeJS.Timeout>();

  const connect = useCallback(() => {
    if (!experimentId) return;

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) return;

    try {
      const wsBase = getWsBase();
    const ws = new WebSocket(`${wsBase}/ws/experiments/${experimentId}?token=${token}`);

      ws.onopen = () => {
        console.log('[WS] Connected for experiment', experimentId);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          onMessage(msg);
        } catch {
          // ignore non-JSON
        }
      };

      ws.onclose = () => {
        console.log('[WS] Disconnected, reconnecting in 5s...');
        reconnectTimer.current = setTimeout(connect, 5000);
      };

      ws.onerror = () => {
        ws.close();
      };

      wsRef.current = ws;
    } catch {
      // WebSocket not supported or connection failed
    }
  }, [experimentId, onMessage]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return wsRef;
}
