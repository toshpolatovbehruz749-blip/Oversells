import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { Storage } from '../storage/storage.js';
import { TEXT_NAME, applyText } from './text-diff.js';

/** y-websocket message types. */
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

/** Origin of changes that come from loading persisted state (not persisted again). */
const LOAD_ORIGIN = Symbol('load');
/** Origin of server-side edits (REST saves, restores). */
export const SERVER_ORIGIN = Symbol('server');

export interface CollabOptions {
  /** Batch Yjs updates for this long before writing them to the database. */
  persistDebounceMs: number;
  /** Write the plain text to file storage this long after the last change. */
  storageDebounceMs: number;
  /** Replace the update log with one snapshot after this many persisted batches. */
  compactAfter: number;
  /** Unload a document this long after its last connection closed. */
  unloadAfterMs: number;
}

export interface CollabHooks {
  /** Called (not awaited) after a document of the project changed. */
  onActivity?(projectId: string): void;
  /** Called (not awaited) when a changed document is unloaded (everyone left). */
  onIdle?(projectId: string): void;
}

/** One WebSocket client of a document. */
export interface CollabConnection {
  send(data: Uint8Array): void;
  close(code: number, reason: string): void;
  /** Viewers may read and show their cursor, but their document updates are dropped. */
  readOnly: boolean;
  shareToken: string | null;
  userId: string | null;
}

/** A loaded document with its connections and persistence state. */
export class SharedDoc {
  readonly doc = new Y.Doc();
  readonly text: Y.Text;
  readonly awareness: awarenessProtocol.Awareness;
  /** connection -> awareness client ids it controls */
  readonly conns = new Map<CollabConnection, Set<number>>();
  pending: Uint8Array[] = [];
  persistTimer: NodeJS.Timeout | null = null;
  storageTimer: NodeJS.Timeout | null = null;
  unloadTimer: NodeJS.Timeout | null = null;
  /** Serialises database writes of this document. */
  chain: Promise<void> = Promise.resolve();
  batchesSinceSnapshot = 0;
  storageDirty = false;
  changedSinceLoad = false;

  constructor(
    readonly fileId: string,
    readonly projectId: string,
  ) {
    this.text = this.doc.getText(TEXT_NAME);
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);
  }
}

function syncMessage(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

function awarenessMessage(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

/**
 * Owns the Yjs documents of all text files (one Y.Doc per file).
 *
 * Persistence: every batch of updates is appended to DocUpdate; after
 * `compactAfter` batches the log is replaced by a single snapshot row. The
 * plain text is mirrored to file storage (debounced) so compiling, ZIP export
 * and versions keep reading files as before. A file without any DocUpdate rows
 * is seeded from storage the first time it is opened.
 *
 * Single-process: running several app instances needs a shared pub/sub
 * (planned for Phase 4).
 */
export class DocManager {
  private readonly docs = new Map<string, SharedDoc>();
  private readonly loading = new Map<string, Promise<SharedDoc>>();
  private closed = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: Storage,
    private readonly opts: CollabOptions,
    private readonly log: Pick<FastifyBaseLogger, 'warn' | 'error'>,
    private readonly hooks: CollabHooks = {},
  ) {}

  /** Loads (or returns) the document of a text file. */
  open(fileId: string): Promise<SharedDoc> {
    const loaded = this.docs.get(fileId);
    if (loaded) return Promise.resolve(loaded);
    let pending = this.loading.get(fileId);
    if (!pending) {
      pending = this.load(fileId).finally(() => this.loading.delete(fileId));
      this.loading.set(fileId, pending);
    }
    return pending;
  }

  private async load(fileId: string): Promise<SharedDoc> {
    const file = await this.prisma.projectFile.findUnique({ where: { id: fileId } });
    if (!file || file.kind !== 'text') throw new Error(`Not a text file: ${fileId}`);
    const shared = new SharedDoc(file.id, file.projectId);
    const rows = await this.prisma.docUpdate.findMany({ where: { fileId }, orderBy: { id: 'asc' } });
    if (rows.length > 0) {
      Y.applyUpdate(shared.doc, Y.mergeUpdates(rows.map((r) => new Uint8Array(r.data))), LOAD_ORIGIN);
      shared.batchesSinceSnapshot = rows.length;
    } else {
      // First collaborative use of this file: start from the stored text.
      const text = (await this.storage.get(file.storageKey)).toString('utf8');
      shared.doc.transact(() => shared.text.insert(0, text), LOAD_ORIGIN);
      await this.prisma.docUpdate.create({
        data: { fileId, data: Buffer.from(Y.encodeStateAsUpdate(shared.doc)), snapshot: true },
      });
    }
    shared.doc.on('update', (update: Uint8Array, origin: unknown) => this.onUpdate(shared, update, origin));
    shared.awareness.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        const changed = [...added, ...updated, ...removed];
        const conn = origin as CollabConnection | null;
        const ids = conn ? shared.conns.get(conn) : undefined;
        if (ids) {
          for (const id of added) ids.add(id);
          for (const id of removed) ids.delete(id);
        }
        const message = awarenessMessage(awarenessProtocol.encodeAwarenessUpdate(shared.awareness, changed));
        for (const c of shared.conns.keys()) c.send(message);
      },
    );
    // A concurrent drop() may have happened while loading.
    const existing = this.docs.get(fileId);
    if (existing) return existing;
    this.docs.set(fileId, shared);
    this.scheduleUnload(shared);
    return shared;
  }

  private onUpdate(shared: SharedDoc, update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN) return;
    const message = syncMessage((e) => syncProtocol.writeUpdate(e, update));
    for (const c of shared.conns.keys()) c.send(message);
    shared.pending.push(update);
    shared.storageDirty = true;
    shared.changedSinceLoad = true;
    if (!shared.persistTimer) {
      shared.persistTimer = setTimeout(() => void this.persist(shared), this.opts.persistDebounceMs);
    }
    if (shared.storageTimer) clearTimeout(shared.storageTimer);
    shared.storageTimer = setTimeout(() => void this.writeStorage(shared), this.opts.storageDebounceMs);
    this.hooks.onActivity?.(shared.projectId);
  }

  /** Appends pending updates to the log (and compacts it when it got long). */
  private persist(shared: SharedDoc): Promise<void> {
    if (shared.persistTimer) {
      clearTimeout(shared.persistTimer);
      shared.persistTimer = null;
    }
    shared.chain = shared.chain
      .then(async () => {
        if (shared.pending.length === 0) return;
        const data = Y.mergeUpdates(shared.pending.splice(0));
        await this.prisma.docUpdate.create({ data: { fileId: shared.fileId, data: Buffer.from(data) } });
        shared.batchesSinceSnapshot++;
        if (shared.batchesSinceSnapshot >= this.opts.compactAfter) await this.compact(shared);
      })
      .catch((err: Error) => this.persistError(shared, err));
    return shared.chain;
  }

  /** Replaces all persisted updates with one snapshot of the current state. */
  private async compact(shared: SharedDoc): Promise<void> {
    const last = await this.prisma.docUpdate.findFirst({
      where: { fileId: shared.fileId },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    if (!last) return;
    const state = Buffer.from(Y.encodeStateAsUpdate(shared.doc));
    await this.prisma.$transaction([
      this.prisma.docUpdate.deleteMany({ where: { fileId: shared.fileId, id: { lte: last.id } } }),
      this.prisma.docUpdate.create({ data: { fileId: shared.fileId, data: state, snapshot: true } }),
    ]);
    shared.batchesSinceSnapshot = 1;
  }

  /** Mirrors the text to file storage and updates size/updatedAt. */
  private writeStorage(shared: SharedDoc): Promise<void> {
    if (shared.storageTimer) {
      clearTimeout(shared.storageTimer);
      shared.storageTimer = null;
    }
    shared.chain = shared.chain
      .then(async () => {
        if (!shared.storageDirty) return;
        shared.storageDirty = false;
        const file = await this.prisma.projectFile.findUnique({ where: { id: shared.fileId } });
        if (!file) return; // deleted meanwhile
        const data = Buffer.from(shared.text.toString(), 'utf8');
        await this.storage.put(file.storageKey, data);
        await this.prisma.projectFile.update({ where: { id: file.id }, data: { size: data.length } });
        await this.prisma.project.update({ where: { id: file.projectId }, data: { updatedAt: new Date() } });
      })
      .catch((err: Error) => this.persistError(shared, err));
    return shared.chain;
  }

  private persistError(shared: SharedDoc, err: Error): void {
    // A deleted file cascades its rows away; anything else is worth logging.
    if (!this.docs.has(shared.fileId)) return;
    this.log.error({ err, fileId: shared.fileId }, 'Failed to persist document');
  }

  /** Writes everything pending for one document to the database and storage. */
  async flushDoc(shared: SharedDoc): Promise<void> {
    await this.persist(shared);
    await this.writeStorage(shared);
  }

  /** Flushes all loaded documents of a project (before compile, ZIP, versions). */
  async flushProject(projectId: string): Promise<void> {
    await Promise.all([...this.docs.values()].filter((d) => d.projectId === projectId).map((d) => this.flushDoc(d)));
  }

  /** Current text if the document is loaded, otherwise null (read storage instead). */
  currentText(fileId: string): string | null {
    return this.docs.get(fileId)?.text.toString() ?? null;
  }

  async getText(fileId: string): Promise<string> {
    return (await this.open(fileId)).text.toString();
  }

  /**
   * Replaces the text as a normal (collaborative) change: connected clients
   * receive it live and history/comments stay intact. Waits until it is persisted.
   */
  async setText(fileId: string, text: string): Promise<boolean> {
    const shared = await this.open(fileId);
    const changed = applyText(shared.text, text, SERVER_ORIGIN);
    await this.flushDoc(shared);
    if (shared.conns.size === 0) this.scheduleUnload(shared);
    return changed;
  }

  /** Attaches a WebSocket client; returns the handlers for its messages and close. */
  async connect(fileId: string, conn: CollabConnection) {
    const shared = await this.open(fileId);
    if (shared.unloadTimer) {
      clearTimeout(shared.unloadTimer);
      shared.unloadTimer = null;
    }
    shared.conns.set(conn, new Set());

    // Start the sync: send our state vector and the current awareness states.
    conn.send(syncMessage((e) => syncProtocol.writeSyncStep1(e, shared.doc)));
    const states = shared.awareness.getStates();
    if (states.size > 0) {
      conn.send(awarenessMessage(awarenessProtocol.encodeAwarenessUpdate(shared.awareness, [...states.keys()])));
    }

    return {
      message: (data: Uint8Array) => this.onMessage(shared, conn, data),
      close: () => this.disconnect(shared, conn),
    };
  }

  private onMessage(shared: SharedDoc, conn: CollabConnection, data: Uint8Array): void {
    try {
      const decoder = decoding.createDecoder(data);
      const type = decoding.readVarUint(decoder);
      if (type === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        if (conn.readOnly) {
          // Viewers: answer their state vector, ignore their changes.
          const syncType = decoding.readVarUint(decoder);
          if (syncType !== syncProtocol.messageYjsSyncStep1) return;
          syncProtocol.readSyncStep1(decoder, encoder, shared.doc);
        } else {
          syncProtocol.readSyncMessage(decoder, encoder, shared.doc, conn);
        }
        if (encoding.length(encoder) > 1) conn.send(encoding.toUint8Array(encoder));
      } else if (type === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(shared.awareness, decoding.readVarUint8Array(decoder), conn);
      }
    } catch (err) {
      this.log.warn({ err, fileId: shared.fileId }, 'Invalid collaboration message');
      conn.close(1003, 'invalid message');
    }
  }

  private disconnect(shared: SharedDoc, conn: CollabConnection): void {
    const ids = shared.conns.get(conn);
    if (!ids) return;
    shared.conns.delete(conn);
    if (ids.size > 0) awarenessProtocol.removeAwarenessStates(shared.awareness, [...ids], null);
    if (shared.conns.size === 0) this.scheduleUnload(shared);
  }

  private scheduleUnload(shared: SharedDoc): void {
    if (shared.unloadTimer) clearTimeout(shared.unloadTimer);
    shared.unloadTimer = setTimeout(() => void this.unload(shared), this.opts.unloadAfterMs);
  }

  private async unload(shared: SharedDoc): Promise<void> {
    shared.unloadTimer = null;
    if (shared.conns.size > 0 || this.docs.get(shared.fileId) !== shared) return;
    await this.flushDoc(shared);
    if (shared.conns.size > 0) return; // someone reconnected while flushing
    this.docs.delete(shared.fileId);
    shared.doc.destroy();
    if (shared.changedSinceLoad) this.hooks.onIdle?.(shared.projectId);
  }

  /** Closes the connections that match (e.g. opened with a revoked share token). */
  closeConnections(match: (conn: CollabConnection, doc: SharedDoc) => boolean, code: number, reason: string): number {
    let closed = 0;
    for (const shared of this.docs.values()) {
      for (const conn of [...shared.conns.keys()]) {
        if (match(conn, shared)) {
          conn.close(code, reason);
          this.disconnect(shared, conn);
          closed++;
        }
      }
    }
    return closed;
  }

  /** Forgets a document whose file is being deleted (no flush). */
  drop(fileId: string): void {
    const shared = this.docs.get(fileId);
    if (!shared) return;
    for (const conn of shared.conns.keys()) conn.close(4404, 'file deleted');
    for (const t of [shared.persistTimer, shared.storageTimer, shared.unloadTimer]) if (t) clearTimeout(t);
    this.docs.delete(fileId);
    shared.doc.destroy();
  }

  dropProject(projectId: string): void {
    for (const shared of [...this.docs.values()]) if (shared.projectId === projectId) this.drop(shared.fileId);
  }

  /** Number of loaded documents (for tests and diagnostics). */
  get size(): number {
    return this.docs.size;
  }

  isLoaded(fileId: string): boolean {
    return this.docs.has(fileId);
  }

  /** Flushes and closes everything (server shutdown). */
  async shutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const shared of [...this.docs.values()]) {
      for (const conn of shared.conns.keys()) conn.close(1001, 'server shutting down');
      shared.conns.clear();
      if (shared.unloadTimer) clearTimeout(shared.unloadTimer);
      await this.flushDoc(shared);
      shared.doc.destroy();
    }
    this.docs.clear();
  }
}
