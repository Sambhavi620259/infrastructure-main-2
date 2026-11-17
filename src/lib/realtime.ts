import { useEffect, useRef, useState } from "react";
import type { Asset } from "@/types/asset";
import type { ScanRecord } from "@/lib/audit";
import { withUtcTimes } from "@/lib/api";

interface AssetUpdateMessage {
  event: "ASSET_CREATED" | "ASSET_UPDATED" | "ASSET_ASSIGNED" | "ASSET_UNASSIGNED" | "ASSET_DELETED";
  asset: Asset;
  timestamp: string;
}

const RECONNECT_DELAY_MS = 5000;
// Close codes the backend uses when it refuses a socket: retrying cannot help.
const REJECTED_CLOSE_CODES = new Set([4004, 4401, 4403]);

// WebSockets cannot go through the Next.js /api proxy, so they connect to the
// backend directly. NEXT_PUBLIC_WS_URL (set when the app is built) names it. Without it,
// local development uses port 8000 of the page's own host; anywhere else live updates are
// simply off, instead of trying an address that cannot be right.
function wsBaseUrl(): string | null {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL.replace(/\/$/, "");
  if (typeof window === "undefined") return null;
  const host = window.location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") return null;
  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${host}:8000`;
}

/**
 * Keeps one WebSocket open to `path` for as long as the component is mounted,
 * reconnecting after drops. `onMessage` is read through a ref, so passing an
 * inline callback does not tear the socket down on every render.
 */
function useWebSocket(path: string | null, label: string, onMessage: (message: unknown) => void) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!path) return;

    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const base = wsBaseUrl();
    if (!base) return;

    const connect = () => {
      // Browsers cannot send an Authorization header on a WebSocket, so the token goes in the
      // subprotocol list ("bearer.<token>"), which keeps it out of the address and the logs.
      const token = window.localStorage.getItem("auth-token") ?? "";
      const ws = new WebSocket(`${base}${path}`, ["itam.v1", `bearer.${token}`]);
      socket = ws;

      ws.onopen = () => setConnected(true);

      ws.onmessage = (event) => {
        try {
          onMessageRef.current(withUtcTimes(JSON.parse(event.data)));
        } catch {
          // Heartbeat replies ("pong: ...") are plain text.
        }
      };

      // A browser error event carries no detail; the close that always follows
      // it is where reconnection is handled, so only note it here.
      ws.onerror = () => {
        if (!disposed) console.warn(`[${label} WS] Connection error; retrying in ${RECONNECT_DELAY_MS / 1000}s.`);
      };

      ws.onclose = (event) => {
        setConnected(false);
        if (REJECTED_CLOSE_CODES.has(event.code)) {
          console.warn(`[${label} WS] Refused by server: ${event.reason || event.code}.`);
          return;
        }
        if (!disposed) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const ws = socket;
      if (!ws) return;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      // Closing a socket that is still connecting makes the browser report an
      // error (this happens on every mount in React Strict Mode), so let it
      // finish opening and close it then.
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.onopen = () => ws.close();
      } else {
        ws.close();
      }
    };
  }, [path, label]);

  return { connected };
}

export function useAssetWebSocket(
  companyId: string | undefined,
  onUpdate: (message: AssetUpdateMessage) => void,
) {
  return useWebSocket(companyId ? `/api/assets/ws/${companyId}` : null, "Asset", (message) => {
    const update = message as Partial<AssetUpdateMessage>;
    if (update.event && update.asset) onUpdate(update as AssetUpdateMessage);
  });
}

export function useAuditWebSocket(sessionId: string | undefined, onScanUpdate: (scan: ScanRecord) => void) {
  return useWebSocket(sessionId ? `/api/physical-audit/ws/${sessionId}` : null, "Audit", (message) => {
    const update = message as { event?: string; scan?: ScanRecord };
    if (update.event === "SCAN_UPDATE" && update.scan) onScanUpdate(update.scan);
  });
}
