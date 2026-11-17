import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createTestContext, type TestClient, type TestContext } from '../helpers/context.js';
import { FakeRunner } from '../helpers/fake-runner.js';
import { connectPeer, listen, until } from '../helpers/collab-client.js';

const FAST = {
  COLLAB_PERSIST_DEBOUNCE_MS: '20',
  COLLAB_STORAGE_DEBOUNCE_MS: '20',
  COLLAB_UNLOAD_AFTER_MS: '60000',
};

async function setup(env: Record<string, string> = {}) {
  const ctx = await createTestContext(new FakeRunner(), { ...FAST, ...env });
  const pid = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Algebra' } })).json().project.id;
  const files = (await ctx.api.inject(`/api/projects/${pid}`)).json().project.files as Array<{ id: string; path: string }>;
  const mainId = files.find((f) => f.path === 'main.tex')!.id;
  const kirishId = files.find((f) => f.path === 'bolimlar/kirish.tex')!.id;
  const viewerToken = (
    await ctx.api.inject({ method: 'POST', url: `/api/projects/${pid}/share-links`, payload: { role: 'viewer' } })
  ).json().link.token as string;
  return { ctx, pid, mainId, kirishId, viewer: ctx.client(viewerToken) };
}

describe('version history', () => {
  let ctx: TestContext;
  let pid: string;
  let mainId: string;
  let kirishId: string;
  let viewer: TestClient;
  afterEach(() => ctx.close());

  const versions = async () => (await ctx.api.inject(`/api/projects/${pid}/versions`)).json().versions;
  const save = (name: string, client: TestClient = ctx.api) =>
    client.inject({ method: 'POST', url: `/api/projects/${pid}/versions`, payload: { name } });
  const setText = (fileId: string, content: string) =>
    ctx.api.inject({ method: 'PUT', url: `/api/projects/${pid}/files/${fileId}/content`, payload: { content } });

  beforeEach(async () => {
    ({ ctx, pid, mainId, kirishId, viewer } = await setup());
  });

  it('saves named versions with their content and author', async () => {
    const res = await save('Birinchi qoralama');
    expect(res.statusCode).toBe(201);
    expect(res.json().version).toMatchObject({ kind: 'named', name: 'Birinchi qoralama', fileCount: 3, createdBy: { name: 'Oʻqituvchi' } });
    const content = (await ctx.api.inject(`/api/projects/${pid}/versions/${res.json().version.id}`)).json();
    expect(content.files.map((f: { path: string }) => f.path)).toEqual(['bolimlar/kirish.tex', 'dizayn.sty', 'main.tex']);
    expect(content.files.find((f: { path: string }) => f.path === 'main.tex').content).toContain('\\babelprovide[import=uz-Latn, main]{uzbek}');
    expect((await save('   ')).statusCode).toBe(400);
  });

  it('takes automatic versions on activity, at most once per interval, skipping unchanged states', async () => {
    const svc = ctx.services.versions;
    // Interval not reached yet (a fresh project counts from now): nothing.
    expect(await svc.maybeAuto(pid)).not.toBeNull(); // first ever version
    await setText(mainId, 'v2');
    expect(await svc.maybeAuto(pid)).toBeNull(); // interval of 10 minutes not over
    // Unchanged content is never saved twice automatically.
    expect(await svc.snapshot(pid, 'auto', null, null)).not.toBeNull();
    expect(await svc.snapshot(pid, 'auto', null, null)).toBeNull();
    expect((await versions()).map((v: { kind: string }) => v.kind)).toEqual(['auto', 'auto']);
  });

  it('creates automatic versions from live editing after the interval', async () => {
    await ctx.close();
    ({ ctx, pid, mainId, kirishId, viewer } = await setup({ AUTO_VERSION_INTERVAL_MS: '1' }));
    const base = await listen(ctx);
    const peer = await connectPeer(base, pid, mainId, ctx.api);
    peer.text.insert(0, '% tahrir 1\n');
    await until(async () => (await versions()).length >= 1, 3000, 'auto version');
    peer.destroy();
    const [latest] = await versions();
    expect(latest.kind).toBe('auto');
  });

  it('restores a version as a new change, keeping the history', async () => {
    const v1 = (await save('Asl nusxa')).json().version;
    const original = (await ctx.api.inject(`/api/projects/${pid}/versions/${v1.id}`)).json().files;

    // Later changes: edit main, delete the chapter file, add a new file.
    await setText(mainId, 'Butunlay boshqa matn');
    await ctx.api.inject({ method: 'DELETE', url: `/api/projects/${pid}/files/${kirishId}` });
    await ctx.api.inject({ method: 'POST', url: `/api/projects/${pid}/files`, payload: { path: 'yangi.tex', content: 'yangi' } });

    // An editor connected live sees the restore happen.
    const base = await listen(ctx);
    const peer = await connectPeer(base, pid, mainId, ctx.api);
    expect(peer.text.toString()).toBe('Butunlay boshqa matn');

    const res = await ctx.api.inject({ method: 'POST', url: `/api/projects/${pid}/versions/${v1.id}/restore` });
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toMatchObject({ kind: 'restore', name: 'Asl nusxa' });

    const mainOld = original.find((f: { path: string }) => f.path === 'main.tex').content;
    await until(() => peer.text.toString() === mainOld, 3000, 'live restore');
    peer.destroy();

    const project = (await ctx.api.inject(`/api/projects/${pid}`)).json().project;
    expect(project.files.map((f: { path: string }) => f.path).sort()).toEqual(['bolimlar/kirish.tex', 'dizayn.sty', 'main.tex', 'yangi.tex']);
    const kirish = project.files.find((f: { path: string }) => f.path === 'bolimlar/kirish.tex');
    expect((await ctx.api.inject(`/api/projects/${pid}/files/${kirish.id}`)).body).toBe(
      original.find((f: { path: string }) => f.path === 'bolimlar/kirish.tex').content,
    );

    // History: restore, the automatic "before restore" state, the named version.
    const list = await versions();
    expect(list.map((v: { kind: string }) => v.kind)).toEqual(['restore', 'auto', 'named']);
    const before = (await ctx.api.inject(`/api/projects/${pid}/versions/${list[1].id}`)).json().files;
    expect(before.find((f: { path: string }) => f.path === 'main.tex').content).toBe('Butunlay boshqa matn');
  });

  it('lets viewers read history but not save or restore', async () => {
    const v1 = (await save('A')).json().version;
    expect((await viewer.inject(`/api/projects/${pid}/versions`)).json().versions).toHaveLength(1);
    expect((await viewer.inject(`/api/projects/${pid}/versions/${v1.id}`)).statusCode).toBe(200);
    expect((await viewer.inject(`/api/projects/${pid}/versions/current`)).json().files).toHaveLength(3);
    expect((await save('B', viewer)).statusCode).toBe(403);
    expect((await viewer.inject({ method: 'POST', url: `/api/projects/${pid}/versions/${v1.id}/restore` })).statusCode).toBe(403);
    expect((await ctx.client().inject(`/api/projects/${pid}/versions`)).statusCode).toBe(404);
  });
});

describe('comments anchored to Yjs positions', () => {
  let ctx: TestContext;
  let pid: string;
  let mainId: string;
  let viewer: TestClient;
  afterEach(() => ctx.close());
  beforeEach(async () => {
    ({ ctx, pid, mainId, viewer } = await setup());
    await ctx.api.inject({
      method: 'PUT',
      url: `/api/projects/${pid}/files/${mainId}/content`,
      payload: { content: 'Birinchi qator.\nKvadrat tenglama muhim mavzu.\nOxirgi qator.\n' },
    });
  });

  /** Relative positions for `quote` in the file, as the web client creates them. */
  const anchorsFor = async (quote: string) => {
    const shared = await ctx.services.docs.open(mainId);
    const from = shared.text.toString().indexOf(quote);
    const start = Y.createRelativePositionFromTypeIndex(shared.text, from, 0);
    const end = Y.createRelativePositionFromTypeIndex(shared.text, from + quote.length, -1);
    const b64 = (p: Y.RelativePosition) => Buffer.from(Y.encodeRelativePosition(p)).toString('base64');
    return { anchorStart: b64(start), anchorEnd: b64(end) };
  };
  const comment = async (quote: string, body: string, client: TestClient = ctx.api) =>
    client.inject({
      method: 'POST',
      url: `/api/projects/${pid}/comments`,
      payload: { fileId: mainId, body, ...(await anchorsFor(quote)) },
    });
  const list = async () => (await ctx.api.inject(`/api/projects/${pid}/comments?fileId=${mainId}`)).json().comments;
  const textAt = async (c: { from: number; to: number }) => (await ctx.services.docs.getText(mainId)).slice(c.from, c.to);

  it('creates a thread on a range and keeps it on that text while editing around it', async () => {
    const res = await comment('Kvadrat tenglama', 'Bu yerga misol qoʻshing');
    expect(res.statusCode).toBe(201);
    expect(res.json().comment).toMatchObject({ quote: 'Kvadrat tenglama', body: 'Bu yerga misol qoʻshing', resolved: false });

    // Edits before, after and right next to the range (as a live collaborator would make them).
    const base = await listen(ctx);
    const peer = await connectPeer(base, pid, mainId, ctx.api);
    peer.text.insert(0, '% Yangi sarlavha\n% yana bir qator\n');
    const text = peer.text.toString();
    peer.text.insert(text.indexOf('muhim'), 'juda ');
    peer.text.insert(peer.text.length, 'Qoʻshimcha.\n');
    await until(async () => (await ctx.services.docs.getText(mainId)) === peer.text.toString(), 3000, 'sync');
    peer.destroy();

    const [thread] = await list();
    expect(await textAt(thread)).toBe('Kvadrat tenglama');
    expect(thread.from).toBeGreaterThan(30);
  });

  it('survives a version restore applied as a diff', async () => {
    const v = (await ctx.api.inject({ method: 'POST', url: `/api/projects/${pid}/versions`, payload: { name: 'v' } })).json().version;
    await comment('muhim mavzu', 'Muhim!');
    await ctx.services.docs.setText(mainId, 'Kirish.\nBirinchi qator.\nKvadrat tenglama muhim mavzu.\n');
    await ctx.api.inject({ method: 'POST', url: `/api/projects/${pid}/versions/${v.id}/restore` });
    const [thread] = await list();
    expect(await textAt(thread)).toBe('muhim mavzu');
  });

  it('reports a detached thread when its text is deleted', async () => {
    await comment('Oxirgi qator', 'Oʻchirilsinmi?');
    await ctx.services.docs.setText(mainId, 'Birinchi qator.\n');
    const [thread] = await list();
    expect(thread).toMatchObject({ from: null, to: null, quote: 'Oxirgi qator' });
  });

  it('supports replies, resolve/reopen and deletion rules', async () => {
    const thread = (await comment('Birinchi', 'Savol')).json().comment;
    const colleague = ctx.client(
      (await ctx.api.inject({ method: 'POST', url: `/api/projects/${pid}/share-links`, payload: { role: 'editor' } })).json().link.token,
    );
    await colleague.register('hamkasb@test.uz', undefined, 'Hamkasb');

    const reply = await colleague.inject({
      method: 'POST',
      url: `/api/projects/${pid}/comments/${thread.id}/replies`,
      payload: { body: 'Javob' },
    });
    expect(reply.json().comment.replies).toEqual([expect.objectContaining({ body: 'Javob', author: expect.objectContaining({ name: 'Hamkasb' }) })]);

    const resolved = await colleague.inject({ method: 'PATCH', url: `/api/projects/${pid}/comments/${thread.id}`, payload: { resolved: true } });
    expect(resolved.json().comment.resolved).toBe(true);
    const reopened = await ctx.api.inject({ method: 'PATCH', url: `/api/projects/${pid}/comments/${thread.id}`, payload: { resolved: false } });
    expect(reopened.json().comment.resolved).toBe(false);

    // Only the author or the project owner may delete.
    expect((await colleague.inject({ method: 'DELETE', url: `/api/projects/${pid}/comments/${thread.id}` })).statusCode).toBe(403);
    const replyId = reply.json().comment.replies[0].id;
    expect((await colleague.inject({ method: 'DELETE', url: `/api/projects/${pid}/comments/${replyId}` })).statusCode).toBe(204);
    expect((await ctx.api.inject({ method: 'DELETE', url: `/api/projects/${pid}/comments/${thread.id}` })).statusCode).toBe(204);
    expect(await list()).toEqual([]);
  });

  it('lets viewers read comments but not write them', async () => {
    await comment('Birinchi', 'Owner izohi');
    expect((await viewer.inject(`/api/projects/${pid}/comments`)).json().comments).toHaveLength(1);
    expect((await comment('Oxirgi', 'viewer', viewer)).statusCode).toBe(403);
    expect((await ctx.client().inject(`/api/projects/${pid}/comments`)).statusCode).toBe(404);
  });

  it('rejects empty bodies and invalid anchors', async () => {
    expect((await comment('Birinchi', '   ')).json().error.code).toBe('invalid_comment');
    const bad = await ctx.api.inject({
      method: 'POST',
      url: `/api/projects/${pid}/comments`,
      payload: { fileId: mainId, body: 'x', anchorStart: '!!!', anchorEnd: 'AAAA' },
    });
    expect(bad.json().error.code).toBe('invalid_anchor');
  });
});

describe('shared with me', () => {
  let ctx: TestContext;
  let pid: string;
  afterEach(() => ctx.close());
  beforeEach(async () => {
    ({ ctx, pid } = await setup());
  });

  it('remembers projects opened through a link until the link is revoked', async () => {
    const link = (await ctx.api.inject({ method: 'POST', url: `/api/projects/${pid}/share-links`, payload: { role: 'editor' } })).json().link;
    const colleague = ctx.client();
    await colleague.register('hamkasb@test.uz');
    expect((await colleague.inject('/api/projects/shared')).json().projects).toEqual([]);

    await colleague.inject(`/api/share/${link.token}`);
    const [shared] = (await colleague.inject('/api/projects/shared')).json().projects;
    expect(shared).toMatchObject({ id: pid, name: 'Algebra', role: 'editor', token: link.token, ownerName: 'Oʻqituvchi' });

    // The owner opening their own link and anonymous visitors are not recorded.
    await ctx.api.inject(`/api/share/${link.token}`);
    await ctx.client().inject(`/api/share/${link.token}`);
    expect(await ctx.prisma.sharedProjectAccess.count()).toBe(1);
    expect((await ctx.api.inject('/api/projects/shared')).json().projects).toEqual([]);

    await ctx.api.inject({ method: 'DELETE', url: `/api/projects/${pid}/share-links/${link.id}` });
    expect((await colleague.inject('/api/projects/shared')).json().projects).toEqual([]);
    expect(await ctx.prisma.sharedProjectAccess.count()).toBe(0);
    expect((await ctx.client().inject('/api/projects/shared')).statusCode).toBe(401);
  });
});
