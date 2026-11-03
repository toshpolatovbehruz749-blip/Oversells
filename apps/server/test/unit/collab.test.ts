import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createTestContext, type TestClient, type TestContext } from '../helpers/context.js';
import { FakeRunner } from '../helpers/fake-runner.js';
import { connectPeer, handshakeStatus, listen, until, type CollabPeer } from '../helpers/collab-client.js';

const FAST = {
  COLLAB_PERSIST_DEBOUNCE_MS: '20',
  COLLAB_STORAGE_DEBOUNCE_MS: '20',
  COLLAB_UNLOAD_AFTER_MS: '150',
  COLLAB_COMPACT_AFTER: '5',
};

describe('real-time collaboration over WebSocket', () => {
  let ctx: TestContext;
  let runner: FakeRunner;
  let base: string;
  let pid: string;
  let mainId: string;
  let viewerToken: string;
  let editorToken: string;
  let editor: TestClient;
  const peers: CollabPeer[] = [];

  const peer = async (client: TestClient | null, share?: string) => {
    const p = await connectPeer(base, pid, mainId, client, { share });
    peers.push(p);
    return p;
  };

  beforeEach(async () => {
    runner = new FakeRunner();
    ctx = await createTestContext(runner, FAST);
    base = await listen(ctx);
    pid = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Hamkor', template: 'blank' } })).json()
      .project.id;
    mainId = (await ctx.api.inject(`/api/projects/${pid}`)).json().project.files[0].id;
    const link = async (role: string) =>
      (await ctx.api.inject({ method: 'POST', url: `/api/projects/${pid}/share-links`, payload: { role } })).json().link.token;
    viewerToken = await link('viewer');
    editorToken = await link('editor');
    editor = ctx.client(editorToken);
    await editor.register('hamkasb@test.uz');
  });

  afterEach(async () => {
    for (const p of peers.splice(0)) p.destroy();
    await ctx.close();
  });

  it('syncs the stored text to a new client and converges concurrent edits', async () => {
    const a = await peer(ctx.api);
    expect(a.text.toString()).toContain('Salom, dunyo!');

    const b = await peer(editor, editorToken);
    expect(b.text.toString()).toBe(a.text.toString());

    // Concurrent edits at both ends of the document.
    a.text.insert(0, '% owner\n');
    b.text.insert(b.text.length, '% editor\n');
    await until(() => a.text.toString() === b.text.toString() && a.text.toString().includes('% editor'), 3000, 'convergence');
    expect(a.text.toString().startsWith('% owner\n')).toBe(true);
    expect(a.text.toString().endsWith('% editor\n')).toBe(true);
  });

  it('mirrors edits to storage so REST reads, ZIP and compile see them', async () => {
    const a = await peer(ctx.api);
    a.text.insert(0, '% jonli tahrir\n');
    // REST reads the live document immediately.
    await until(async () => (await ctx.api.inject(`/api/projects/${pid}/files/${mainId}`)).body.startsWith('% jonli tahrir'));
    // Compile flushes live documents before reading storage.
    await ctx.api.inject({ method: 'POST', url: `/api/projects/${pid}/compile`, payload: { wait: true } });
    expect(runner.requests[0]!.files.find((f) => f.path === 'main.tex')!.data.toString()).toMatch(/^% jonli tahrir/);
    const file = await ctx.prisma.projectFile.findUniqueOrThrow({ where: { id: mainId } });
    const stored = (await ctx.services.storage.get(file.storageKey)).toString();
    expect(stored).toMatch(/^% jonli tahrir/);
    expect(file.size).toBe(Buffer.byteLength(stored));
  });

  it('pushes REST saves to connected editors live', async () => {
    const a = await peer(ctx.api);
    const res = await editor.inject({
      method: 'PUT',
      url: `/api/projects/${pid}/files/${mainId}/content`,
      payload: { content: 'Yangi matn: oʻquvchi\n' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().file.size).toBe(Buffer.byteLength('Yangi matn: oʻquvchi\n'));
    await until(() => a.text.toString() === 'Yangi matn: oʻquvchi\n', 3000, 'live REST save');
  });

  it('gives viewers a read-only document: their changes are dropped', async () => {
    const owner = await peer(ctx.api);
    const viewer = await peer(null, viewerToken);
    expect(viewer.text.toString()).toBe(owner.text.toString());

    viewer.text.insert(0, 'VIEWER WAS HERE ');
    owner.text.insert(0, '% owner edit\n');
    await until(() => viewer.text.toString().includes('% owner edit'), 3000, 'viewer receives updates');
    await new Promise((r) => setTimeout(r, 200));
    expect(owner.text.toString()).not.toContain('VIEWER WAS HERE');
    expect(await ctx.services.docs.getText(mainId)).not.toContain('VIEWER WAS HERE');
  });

  it('treats an anonymous holder of an editor link as a viewer', async () => {
    const owner = await peer(ctx.api);
    const anon = await peer(null, editorToken);
    anon.text.insert(0, 'ANON ');
    await new Promise((r) => setTimeout(r, 200));
    expect(owner.text.toString()).not.toContain('ANON');
  });

  it('refuses connections without access, from other sites, and to binary or unknown files', async () => {
    const url = (fileId = mainId, query = '') => `${base}/api/collab/${pid}/${fileId}${query}`;
    const stranger = ctx.client();
    await stranger.register('begona@test.uz');
    expect(await handshakeStatus(url(), null)).toBe(404);
    expect(await handshakeStatus(url(), stranger)).toBe(404);
    expect(await handshakeStatus(url(mainId, '?share=wrong-token'), null)).toBe(404);
    expect(await handshakeStatus(url(mainId, `?share=${viewerToken}`), null)).toBe(101);
    expect(await handshakeStatus(url(), ctx.api)).toBe(101);
    // Cross-site WebSocket hijacking: the browser sends the victim's cookies but a foreign Origin.
    expect(await handshakeStatus(url(), ctx.api, 'https://evil.example')).toBe(403);
    expect(await handshakeStatus(url('nonexistent'), ctx.api)).toBe(404);
    const upload = await ctx.api.inject({
      method: 'POST',
      url: `/api/projects/${pid}/upload`,
      payload: Buffer.from(
        '--b\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n\r\n\x89PNG\r\n--b--\r\n',
        'latin1',
      ),
      headers: { 'content-type': 'multipart/form-data; boundary=b' },
    });
    expect(await handshakeStatus(url(upload.json().files[0].id), ctx.api)).toBe(404);
  });

  it('disconnects live sessions when their share link is revoked', async () => {
    const viewer = await peer(null, viewerToken);
    let closeCode = 0;
    viewer.provider.ws?.addEventListener('close', (e) => (closeCode = (e as CloseEvent).code));
    const links = (await ctx.api.inject(`/api/projects/${pid}/share-links`)).json().links;
    const viewerLink = links.find((l: { token: string }) => l.token === viewerToken);
    await ctx.api.inject({ method: 'DELETE', url: `/api/projects/${pid}/share-links/${viewerLink.id}` });
    await until(() => closeCode !== 0, 3000, 'close');
    expect(closeCode).toBe(4403);
    // Reconnecting with the revoked link is refused.
    expect(await handshakeStatus(`${base}/api/collab/${pid}/${mainId}?share=${viewerToken}`, null)).toBe(404);
  });

  it('keeps offline edits and merges them after reconnecting', async () => {
    const a = await peer(ctx.api);
    const b = await peer(editor, editorToken);
    b.provider.disconnect();
    await until(() => !b.provider.wsconnected, 3000, 'disconnect');

    b.text.insert(0, '% oflayn tahrir\n'); // made while offline
    a.text.insert(a.text.length, '% onlayn tahrir\n');
    await new Promise((r) => setTimeout(r, 100));
    expect(a.text.toString()).not.toContain('oflayn');

    b.provider.connect();
    await until(
      () => a.text.toString() === b.text.toString() && a.text.toString().includes('oflayn') && b.text.toString().includes('onlayn'),
      5000,
      'merge after reconnect',
    );
  });

  it('shares cursors and names through awareness', async () => {
    const a = await peer(ctx.api);
    const b = await peer(editor, editorToken);
    a.provider.awareness.setLocalStateField('user', { name: 'Oʻqituvchi', color: '#1f6f5c' });
    await until(
      () => [...b.provider.awareness.getStates().values()].some((s) => (s.user as { name?: string })?.name === 'Oʻqituvchi'),
      3000,
      'awareness',
    );
    // When a leaves, its cursor disappears for b.
    a.destroy();
    peers.splice(peers.indexOf(a), 1);
    await until(
      () => ![...b.provider.awareness.getStates().values()].some((s) => (s.user as { name?: string })?.name === 'Oʻqituvchi'),
      3000,
      'awareness removal',
    );
  });
});

describe('document persistence', () => {
  let ctx: TestContext;
  let pid: string;
  let mainId: string;
  afterEach(() => ctx.close());
  beforeEach(async () => {
    ctx = await createTestContext(new FakeRunner(), FAST);
    pid = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'P', template: 'blank' } })).json()
      .project.id;
    mainId = (await ctx.api.inject(`/api/projects/${pid}`)).json().project.files[0].id;
  });

  it('stores incremental updates, compacts them into a snapshot and reloads the same text', async () => {
    const docs = ctx.services.docs;
    const shared = await docs.open(mainId);
    // Seeded from storage as one snapshot row.
    expect(await ctx.prisma.docUpdate.findMany({ where: { fileId: mainId }, select: { snapshot: true } })).toEqual([
      { snapshot: true },
    ]);

    for (let i = 0; i < 3; i++) {
      shared.text.insert(shared.text.length, `qator ${i}\n`);
      await docs.flushDoc(shared);
    }
    const rows = await ctx.prisma.docUpdate.findMany({ where: { fileId: mainId }, orderBy: { id: 'asc' } });
    expect(rows.map((r) => r.snapshot)).toEqual([true, false, false, false]);

    // Two more batches reach COLLAB_COMPACT_AFTER=5: the log becomes one snapshot.
    for (let i = 3; i < 5; i++) {
      shared.text.insert(shared.text.length, `qator ${i}\n`);
      await docs.flushDoc(shared);
    }
    const compacted = await ctx.prisma.docUpdate.findMany({ where: { fileId: mainId } });
    expect(compacted).toHaveLength(1);
    expect(compacted[0]!.snapshot).toBe(true);

    const expected = shared.text.toString();
    // Unload (no connections) and load again from the database.
    await until(() => !docs.isLoaded(mainId), 3000, 'unload');
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, new Uint8Array(compacted[0]!.data));
    expect(fresh.getText('content').toString()).toBe(expected);
    expect(await docs.getText(mainId)).toBe(expected);
  });

  it('deleting a file drops its document and its updates', async () => {
    await ctx.services.docs.setText(mainId, 'x');
    expect(ctx.services.docs.isLoaded(mainId)).toBe(true);
    await ctx.api.inject({ method: 'DELETE', url: `/api/projects/${pid}/files/${mainId}` });
    expect(ctx.services.docs.isLoaded(mainId)).toBe(false);
    expect(await ctx.prisma.docUpdate.count({ where: { fileId: mainId } })).toBe(0);
  });
});
