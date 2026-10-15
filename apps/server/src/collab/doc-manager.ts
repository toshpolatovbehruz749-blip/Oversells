import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { Storage } from '../storage/storage.js';
import { TEXT_NAME, applyText } from './text-diff.js';
import { fromB64, toB64, type CloseCriteria, type ControlMessage, type DocBus, type DocBusMessage } from './bus.js';

/** y-websocket message types. */
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

/** Origin of changes that come from loading persisted state (not persisted again). */
const LOAD_ORIGIN = Symbol('load');
/** Origin of changes received from another app instance (persisted there). */
const BUS_ORIGIN = Symbol('bus');
/** How long a cluster-wide flush waits for the other instances. */
const CLUSTER_FLUSH_TIMEOUT_MS = 3000;
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
 * Several app instances (optional DocBus, Redis): every instance that has a
 * document loaded subscribes to its channel; updates and awareness made on
 * one instance are published to the others. Each instance persists only the
 * updates its own clients (or server edits) made; compaction merges the rows
 * in the database, so it never depends on one instance's memory.
 */
export class DocManager {
  private readonly docs = new Map<string, SharedDoc>();
  private readonly loading = new Map<string, Promise<SharedDoc>>();
  /** Cluster flushes waiting for answers: request id -> remaining answers. */
  private readonly flushWaiters = new Map<string, { remaining: number; done: () => void }>();
  private closed = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: Storage,
    private readonly opts: CollabOptions,
    private readonly log: Pick<FastifyBaseLogger, 'warn' | 'error'>,
    private readonly hooks: CollabHooks = {},
    private readonly bus: DocBus | null = null,
  ) {
    bus?.onControl((m) => void this.onControl(m));
  }

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
    // Cluster: listen before reading the database, so no update falls in between.
    const early: DocBusMessage[] = [];
    if (this.bus) {
      await this.bus.subscribeDoc(fileId, (m) => {
        const loaded = this.docs.get(fileId);
        if (loaded) this.onBus(loaded, m);
        else early.push(m);
      });
    }
    try {
      const { rows, seeded } = await this.loadRows(fileId, file.storageKey);
      Y.applyUpdate(shared.doc, Y.mergeUpdates(rows.map((r) => new Uint8Array(r.data))), LOAD_ORIGIN);
      shared.batchesSinceSnapshot = seeded ? 0 : rows.length;
    } catch (err) {
      if (this.bus && !this.docs.has(fileId)) await this.bus.unsubscribeDoc(fileId);
      throw err;
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
        const update = awarenessProtocol.encodeAwarenessUpdate(shared.awareness, changed);
        const message = awarenessMessage(update);
        for (const c of shared.conns.keys()) c.send(message);
        if (this.bus && origin !== BUS_ORIGIN) {
          this.bus.publishDoc(shared.fileId, { t: 'awareness', from: this.bus.instanceId, data: toB64(update) });
        }
      },
    );
    // A concurrent drop() may have happened while loading.
    const existing = this.docs.get(fileId);
    if (existing) return existing;
    this.docs.set(fileId, shared);
    this.scheduleUnload(shared);
    if (this.bus) {
      for (const m of early.splice(0)) this.onBus(shared, m);
      // Ask instances that have it open for what is not in the database yet.
      const sv = toB64(Y.encodeStateVector(shared.doc));
      this.bus.publishDoc(fileId, { t: 'sync-req', from: this.bus.instanceId, sv });
    }
    return shared;
  }

  /**
   * The persisted updates of a file. A file without any is seeded from the
   * stored text, under a lock so two instances cannot seed it twice.
   */
  private async loadRows(fileId: string, storageKey: string): Promise<{ rows: Array<{ data: Uint8Array }>; seeded: boolean }> {
    const rows = await this.prisma.docUpdate.findMany({ where: { fileId }, orderBy: { id: 'asc' } });
    if (rows.length > 0) return { rows, seeded: false };
    // First collaborative use of this file: start from the stored text.
    const text = (await this.storage.get(storageKey)).toString('utf8');
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'doc:' + fileId}))`;
      if ((await tx.docUpdate.count({ where: { fileId } })) > 0) return;
      const seed = new Y.Doc();
      seed.getText(TEXT_NAME).insert(0, text);
      await tx.docUpdate.create({ data: { fileId, data: Buffer.from(Y.encodeStateAsUpdate(seed)), snapshot: true } });
      seed.destroy();
    });
    return { rows: await this.prisma.docUpdate.findMany({ where: { fileId }, orderBy: { id: 'asc' } }), seeded: true };
  }

  /** A message about a loaded document from another instance. */
  private onBus(shared: SharedDoc, m: DocBusMessage): void {
    try {
      switch (m.t) {
        case 'update':
        case 'sync-res':
          Y.applyUpdate(shared.doc, fromB64(m.data), BUS_ORIGIN);
          break;
        case 'awareness':
          awarenessProtocol.applyAwarenessUpdate(shared.awareness, fromB64(m.data), BUS_ORIGIN);
          break;
        case 'sync-req': {
          const bus = this.bus!;
          const data = toB64(Y.encodeStateAsUpdate(shared.doc, fromB64(m.sv)));
          bus.publishDoc(shared.fileId, { t: 'sync-res', from: bus.instanceId, to: m.from, data });
          const states = [...shared.awareness.getStates().keys()];
          if (states.length > 0) {
            const update = awarenessProtocol.encodeAwarenessUpdate(shared.awareness, states);
            bus.publishDoc(shared.fileId, { t: 'awareness', from: bus.instanceId, data: toB64(update) });
          }
          break;
        }
      }
    } catch (err) {
      this.log.warn({ err, fileId: shared.fileId }, 'Invalid message from another instance');
    }
  }

  private async onControl(m: ControlMessage): Promise<void> {
    const bus = this.bus!;
    switch (m.t) {
      case 'flush':
        await this.flushLocal(m.projectId).catch(() => undefined);
        bus.publishControl({ t: 'flushed', from: bus.instanceId, to: m.from, reqId: m.reqId });
        break;
      case 'flushed': {
        const w = this.flushWaiters.get(m.reqId);
        if (w && --w.remaining <= 0) w.done();
        break;
      }
      case 'close':
        this.closeLocal(m.criteria, m.code, m.reason);
        break;
      case 'drop':
        for (const id of m.fileIds) this.dropLocal(id);
        break;
    }
  }

  private onUpdate(shared: SharedDoc, update: Uint8Array, origin: unknown): void {
    if (origin === LOAD_ORIGIN) return;
    const message = syncMessage((e) => syncProtocol.writeUpdate(e, update));
    for (const c of shared.conns.keys()) c.send(message);
    // Every instance mirrors the text it has; they converge on the same text.
    shared.storageDirty = true;
    if (shared.storageTimer) clearTimeout(shared.storageTimer);
    shared.storageTimer = setTimeout(() => void this.writeStorage(shared), this.opts.storageDebounceMs);
    // Changes from another instance are persisted there.
    if (origin === BUS_ORIGIN) return;
    this.bus?.publishDoc(shared.fileId, { t: 'update', from: this.bus.instanceId, data: toB64(update) });
    shared.pending.push(update);
    shared.changedSinceLoad = true;
    if (!shared.persistTimer) {
      shared.persistTimer = setTimeout(() => void this.persist(shared), this.opts.persistDebounceMs);
    }
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

  /**
   * Replaces the persisted updates with one snapshot that merges exactly those
   * rows (not this instance's memory, which may lack another instance's rows).
   */
  private async compact(shared: SharedDoc): Promise<void> {
    const rows = await this.prisma.docUpdate.findMany({
      where: { fileId: shared.fileId },
      orderBy: { id: 'asc' },
      select: { id: true, data: true },
    });
    if (rows.length < 2) return;
    const last = rows[rows.length - 1]!.id;
    const merged = Buffer.from(Y.mergeUpdates(rows.map((r) => new Uint8Array(r.data))));
    await this.prisma.$transaction([
      this.prisma.docUpdate.deleteMany({ where: { fileId: shared.fileId, id: { lte: last } } }),
      this.prisma.docUpdate.create({ data: { fileId: shared.fileId, data: merged, snapshot: true } }),
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

  /**
   * Flushes all loaded documents of a project (before compile, ZIP, versions).
   * With several instances, the others are asked to flush theirs too and the
   * call waits for their answers (at most a few seconds).
   */
  async flushProject(projectId: string): Promise<void> {
    await this.flushLocal(projectId);
    const bus = this.bus;
    if (!bus) return;
    const peers = await bus.peers().catch(() => 0);
    if (peers === 0) return;
    const reqId = `${bus.instanceId}:${Math.random().toString(36).slice(2)}`;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, CLUSTER_FLUSH_TIMEOUT_MS);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.flushWaiters.set(reqId, { remaining: peers, done });
      bus.publishControl({ t: 'flush', from: bus.instanceId, projectId, reqId });
    });
    this.flushWaiters.delete(reqId);
  }

  private async flushLocal(projectId: string): Promise<void> {
    await Promise.all([...this.docs.values()].filter((d) => d.projectId === projectId).map((d) => this.flushDoc(d)));
  }

  /**
   * Before a server-side edit of a document this instance has not loaded:
   * other instances persist what they have, so loading from the database is current.
   */
  private async freshen(fileId: string): Promise<void> {
    if (!this.bus || this.docs.has(fileId)) return;
    const file = await this.prisma.projectFile.findUnique({ where: { id: fileId }, select: { projectId: true } });
    if (file) await this.flushProject(file.projectId);
  }

  /** Current text if the document is loaded, otherwise null (read storage instead). */
  currentText(fileId: string): string | null {
    return this.docs.get(fileId)?.text.toString() ?? null;
  }

  async getText(fileId: string): Promise<string> {
    await this.freshen(fileId);
    return (await this.open(fileId)).text.toString();
  }

  /**
   * Replaces the text as a normal (collaborative) change: connected clients
   * receive it live and history/comments stay intact. Waits until it is persisted.
   */
  async setText(fileId: string, text: string): Promise<boolean> {
    await this.freshen(fileId);
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
    void this.bus?.unsubscribeDoc(shared.fileId);
    shared.doc.destroy();
    if (shared.changedSinceLoad) this.hooks.onIdle?.(shared.projectId);
  }

  /**
   * Closes the connections that match any criterion (a revoked share token, a
   * blocked user, the projects of a blocked user), on every instance.
   */
  closeConnections(criteria: CloseCriteria, code: number, reason: string): number {
    this.bus?.publishControl({ t: 'close', from: this.bus.instanceId, criteria, code, reason });
    return this.closeLocal(criteria, code, reason);
  }

  private closeLocal(criteria: CloseCriteria, code: number, reason: string): number {
    const projects = new Set(criteria.projectIds ?? []);
    const match = (conn: CollabConnection, doc: SharedDoc) =>
      (criteria.userId !== undefined && conn.userId === criteria.userId) ||
      (criteria.shareToken !== undefined && conn.shareToken === criteria.shareToken) ||
      projects.has(doc.projectId);
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

  /** Forgets a document whose file is being deleted (no flush), on every instance. */
  drop(fileId: string): void {
    this.bus?.publishControl({ t: 'drop', from: this.bus.instanceId, fileIds: [fileId] });
    this.dropLocal(fileId);
  }

  private dropLocal(fileId: string): void {
    const shared = this.docs.get(fileId);
    if (!shared) return;
    for (const conn of shared.conns.keys()) conn.close(4404, 'file deleted');
    for (const t of [shared.persistTimer, shared.storageTimer, shared.unloadTimer]) if (t) clearTimeout(t);
    this.docs.delete(fileId);
    void this.bus?.unsubscribeDoc(fileId);
    shared.doc.destroy();
  }

  /** Drops the documents of a project being deleted (call before deleting its rows). */
  async dropProject(projectId: string): Promise<void> {
    const files = await this.prisma.projectFile.findMany({ where: { projectId, kind: 'text' }, select: { id: true } });
    const ids = new Set([...files.map((f) => f.id), ...[...this.docs.values()].filter((d) => d.projectId === projectId).map((d) => d.fileId)]);
    if (ids.size === 0) return;
    this.bus?.publishControl({ t: 'drop', from: this.bus.instanceId, fileIds: [...ids] });
    for (const id of ids) this.dropLocal(id);
  }

  /**
   * Who has which file of a project open right now (from the awareness
   * states of the connections on this instance): for dots in the file tree.
   */
  presence(projectId: string): Array<{ fileId: string; users: Array<{ userId: string | null; name: string; color: string }> }> {
    const out = [];
    for (const shared of this.docs.values()) {
      if (shared.projectId !== projectId || shared.conns.size === 0) continue;
      const users = new Map<string, { userId: string | null; name: string; color: string }>();
      for (const [conn, ids] of shared.conns) {
        for (const id of ids) {
          const user = (shared.awareness.getStates().get(id) as { user?: { name?: unknown; color?: unknown } } | undefined)?.user;
          if (typeof user?.name !== 'string') continue;
          const color = typeof user.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(user.color) ? user.color : '#888888';
          users.set(`${conn.userId ?? ''}|${user.name}`, { userId: conn.userId, name: user.name.slice(0, 100), color });
        }
      }
      if (users.size) out.push({ fileId: shared.fileId, users: [...users.values()] });
    }
    return out;
  }

  /** Open connections over all loaded documents (for metrics). */
  get connectionCount(): number {
    let n = 0;
    for (const d of this.docs.values()) n += d.conns.size;
    return n;
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
