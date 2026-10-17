import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

/** Must match the server (apps/server/src/collab/text-diff.ts). */
export const TEXT_NAME = 'content';

export type ConnectionStatus = 'connecting' | 'connected' | 'offline';

export interface CollabUser {
  name: string;
  color: string;
  colorLight: string;
}

/** One collaboratively edited text file. */
export interface FileSession {
  fileId: string;
  doc: Y.Doc;
  text: Y.Text;
  provider: WebsocketProvider;
  undoManager: Y.UndoManager;
  /** Resolves once the first sync with the server finished. */
  synced: Promise<void>;
}

const COLORS = ['#1f6f5c', '#b3261e', '#2f5fb3', '#9a6700', '#7b3fa1', '#c2185b', '#00796b', '#5d4037'];

/** Stable colour per user (same person, same colour for everyone). */
export function userColor(seed: string): { color: string; colorLight: string } {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  const color = COLORS[h % COLORS.length]!;
  return { color, colorLight: `${color}33` };
}

function collabUrl(projectId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/api/collab/${encodeURIComponent(projectId)}`;
}

/**
 * Real-time connections of one open project: a Y.Doc and a y-websocket
 * provider per text file, kept while the project is open so undo history and
 * offline edits survive switching files. While offline, edits stay in the
 * Y.Doc and are merged after the provider reconnects (it retries on its own).
 */
export class CollabSession {
  private readonly files = new Map<string, FileSession>();
  private readonly listeners = new Set<(s: ConnectionStatus) => void>();
  private readonly editListeners = new Set<() => void>();
  private lastStatus: ConnectionStatus = 'connecting';

  constructor(
    private readonly projectId: string,
    private readonly shareToken: string | null,
    private user: CollabUser,
  ) {}

  get(fileId: string): FileSession {
    const existing = this.files.get(fileId);
    if (existing) return existing;
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(collabUrl(this.projectId), fileId, doc, {
      params: this.shareToken ? { share: this.shareToken } : {},
      // Other tabs of the same browser go through the server too (keeps access checks simple).
      disableBc: true,
      maxBackoffTime: 5000,
    });
    provider.awareness.setLocalStateField('user', this.user);
    const text = doc.getText(TEXT_NAME);
    const synced = new Promise<void>((resolve) => {
      if (provider.synced) resolve();
      else provider.once('sync', (isSynced: boolean) => isSynced && resolve());
    });
    provider.on('status', () => this.emit());
    // Changes made here (not the ones that arrive from the server).
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin !== provider) for (const l of this.editListeners) l();
    });
    const session: FileSession = {
      fileId,
      doc,
      text,
      provider,
      undoManager: new Y.UndoManager(text),
      synced,
    };
    this.files.set(fileId, session);
    this.emit();
    return session;
  }

  /** Stops editing a file (deleted or replaced). */
  forget(fileId: string): void {
    const s = this.files.get(fileId);
    if (!s) return;
    this.files.delete(fileId);
    s.provider.destroy();
    s.doc.destroy();
    this.emit();
  }

  status(): ConnectionStatus {
    const all = [...this.files.values()];
    if (all.length === 0) return 'connected';
    if (all.some((s) => !s.provider.wsconnected && !s.provider.wsconnecting)) return 'offline';
    if (all.some((s) => !s.provider.wsconnected || !s.provider.synced)) return 'connecting';
    return 'connected';
  }

  onStatus(listener: (s: ConnectionStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called after every local edit of any open file. */
  onEdit(listener: () => void): () => void {
    this.editListeners.add(listener);
    return () => this.editListeners.delete(listener);
  }

  private emit(): void {
    const s = this.status();
    if (s === this.lastStatus) return;
    this.lastStatus = s;
    for (const l of this.listeners) l(s);
  }

  /** Re-evaluates the status (e.g. after a sync event). */
  refresh(): void {
    this.emit();
  }

  /** Waits (up to `ms`) until local edits have been handed to the network. */
  async waitForUpload(ms = 1500): Promise<void> {
    const end = Date.now() + ms;
    const pending = () => [...this.files.values()].some((s) => (s.provider.ws?.bufferedAmount ?? 0) > 0);
    while (pending() && Date.now() < end) await new Promise((r) => setTimeout(r, 30));
  }

  destroy(): void {
    for (const id of [...this.files.keys()]) this.forget(id);
    this.listeners.clear();
    this.editListeners.clear();
  }
}
