import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { TestClient, TestContext } from './context.js';

/** Starts the test app on a random port (idempotent) and returns its ws:// base URL. */
export async function listen(ctx: TestContext): Promise<string> {
  if (!ctx.app.server.listening) await ctx.app.listen({ host: '127.0.0.1', port: 0 });
  return `ws://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}`;
}

/** A WebSocket class that sends the test client's cookies (and an optional Origin). */
function socketClass(client: TestClient | null, origin?: string): typeof WebSocket {
  const cookie = client ? [...client.cookies].map(([k, v]) => `${k}=${v}`).join('; ') : '';
  return class extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const headers: Record<string, string> = {};
      if (cookie) headers.cookie = cookie;
      if (origin) headers.origin = origin;
      super(url, protocols, { headers });
    }
  } as unknown as typeof WebSocket;
}

export interface CollabPeer {
  doc: Y.Doc;
  text: Y.Text;
  provider: WebsocketProvider;
  destroy(): void;
}

/** Connects a Y.Doc to /api/collab/:projectId/:fileId as the given client. */
export async function connectPeer(
  base: string,
  projectId: string,
  fileId: string,
  client: TestClient | null,
  opts: { share?: string; origin?: string; waitForSync?: boolean } = {},
): Promise<CollabPeer> {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`${base}/api/collab/${projectId}`, fileId, doc, {
    WebSocketPolyfill: socketClass(client, opts.origin) as never,
    params: opts.share ? { share: opts.share } : {},
    disableBc: true, // otherwise peers in one process would sync without the server
    maxBackoffTime: 200,
  });
  const peer = {
    doc,
    text: doc.getText('content'),
    provider,
    destroy() {
      provider.destroy();
      doc.destroy();
    },
  };
  if (opts.waitForSync !== false) {
    await until(() => provider.synced, 5000, 'sync');
  }
  return peer;
}

/** Waits until `cond` is true (polling). */
export async function until(cond: () => boolean | Promise<boolean>, ms = 5000, what = 'condition'): Promise<void> {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Opens a raw WebSocket and resolves with the HTTP status of a refused handshake (or 101). */
export function handshakeStatus(url: string, client: TestClient | null, origin?: string): Promise<number> {
  const Ws = socketClass(client, origin);
  return new Promise((resolve) => {
    const ws = new Ws(url) as unknown as WebSocket;
    ws.on('open', () => {
      ws.close();
      resolve(101);
    });
    ws.on('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
      res.resume();
    });
    ws.on('error', () => undefined);
  });
}
