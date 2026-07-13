// Authenticated WebSocket connection to the chat hub (GET /ws?token=).
//
// One connection per dashboard session, kept open for as long as the user is
// signed in — this is how encrypted messages arrive in real time regardless
// of which conversation (if any) is currently open. Reconnects with a fixed
// backoff on drop; the backend's own ping/pong keeps idle connections alive.

'use client';

import { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '@/lib/api';
import { getToken } from '@/lib/session';

const RECONNECT_DELAY_MS = 3000;

export type ChatSocketStatus = 'connecting' | 'open' | 'closed';

function buildWsUrl(token: string): string {
  const url = new URL(API_BASE_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.searchParams.set('token', token);
  return url.toString();
}

export function useChatSocket(onMessage: (data: unknown) => void) {
  const [status, setStatus] = useState<ChatSocketStatus>('connecting');
  const socketRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setStatus('closed');
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      const socket = new WebSocket(buildWsUrl(token as string));
      socketRef.current = socket;
      setStatus('connecting');

      socket.onopen = () => {
        // If cleanup already ran (React Strict Mode's dev-only mount/unmount/
        // remount cycle, or a fast unmount) before the handshake finished, close
        // here instead of mid-CONNECTING — closing a CONNECTING socket is what
        // triggers the browser's "closed before connection established" warning.
        if (cancelled) {
          socket.close();
          return;
        }
        setStatus('open');
      };
      socket.onclose = () => {
        if (cancelled) return;
        setStatus('closed');
        retryTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
      socket.onerror = () => {
        socket.close();
      };
      socket.onmessage = (event) => {
        try {
          onMessageRef.current(JSON.parse(event.data));
        } catch {
          // Malformed frame — ignore rather than crash the connection.
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      // Only close here if the handshake already completed — closing a socket
      // that's still CONNECTING is deferred to the onopen handler above.
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.close();
      }
    };
  }, []);

  function send(payload: unknown): boolean {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  return { status, send };
}
