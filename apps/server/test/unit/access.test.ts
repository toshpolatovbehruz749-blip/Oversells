import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, multipart, type TestClient, type TestContext } from '../helpers/context.js';
import { FakeRunner } from '../helpers/fake-runner.js';

type Who = 'owner' | 'editor' | 'editorAnon' | 'viewer' | 'stranger' | 'anonymous';

/**
 * Access control matrix. Roles:
 *  owner       – created the project
 *  editor      – logged-in user holding an editor link
 *  editorAnon  – anonymous holder of an editor link (gets viewer rights)
 *  viewer      – anonymous holder of a viewer link
 *  stranger    – logged-in user without a link
 *  anonymous   – no session, no link
 */
describe('project access control', () => {
  let ctx: TestContext;
  let pid: string;
  let mainId: string;
  let viewerToken: string;
  let editorToken: string;
  const clients = {} as Record<Who, TestClient>;

  beforeEach(async () => {
    ctx = await createTestContext(new FakeRunner());
    const project = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Maxfiy' } })).json().project;
    pid = project.id;
    mainId = (await ctx.api.inject(`/api/projects/${pid}`)).json().project.files.find((f: { path: string }) => f.path === 'main.tex').id;
    const link = async (role: string) =>
      (await ctx.api.inject({ method: 'POST', url: `/api/projects/${pid}/share-links`, payload: { role } })).json().link.token;
    viewerToken = await link('viewer');
    editorToken = await link('editor');

    clients.owner = ctx.api;
    clients.editor = ctx.client(editorToken);
    await clients.editor.register('editor@test.uz');
    clients.editorAnon = ctx.client(editorToken);
    clients.viewer = ctx.client(viewerToken);
    clients.stranger = ctx.client();
    await clients.stranger.register('stranger@test.uz');
    clients.anonymous = ctx.client();
  });
  afterEach(() => ctx.close());

  const ALL: Who[] = ['owner', 'editor', 'editorAnon', 'viewer', 'stranger', 'anonymous'];

  /** Expected status per caller: read access for owner/editor/viewer, 404 for others. */
  const READ = { owner: 200, editor: 200, editorAnon: 200, viewer: 200, stranger: 404, anonymous: 404 };
  const WRITE = { owner: 'ok', editor: 'ok', editorAnon: 403, viewer: 403, stranger: 404, anonymous: 404 } as const;
  const OWNER = { owner: 'ok', editor: 403, editorAnon: 403, viewer: 403, stranger: 404, anonymous: 404 } as const;

  const expectStatus = (who: Who, status: number, expected: number | 'ok') => {
    if (expected === 'ok') expect(status, who).toBeLessThan(300);
    else expect(status, who).toBe(expected);
  };

  it.each(ALL)('read endpoints for %s', async (who) => {
    const c = clients[who];
    const detail = await c.inject(`/api/projects/${pid}`);
    expect(detail.statusCode).toBe(READ[who]);
    if (detail.statusCode === 200) {
      const expectedAccess = who === 'owner' ? 'owner' : who === 'editor' ? 'editor' : 'viewer';
      expect(detail.json().project.access).toBe(expectedAccess);
    } else {
      expect(detail.json().error.code).toBe('not_found');
    }
    expect((await c.inject(`/api/projects/${pid}/files/${mainId}`)).statusCode).toBe(READ[who]);
    expect((await c.inject(`/api/projects/${pid}/download.zip`)).statusCode).toBe(READ[who]);
    expect((await c.inject(`/api/projects/${pid}/compile/latest`)).statusCode).toBe(READ[who]);

    // Viewers may compile and download the PDF.
    const compile = await c.inject({ method: 'POST', url: `/api/projects/${pid}/compile`, payload: { wait: true } });
    expect(compile.statusCode).toBe(READ[who]);
    if (compile.statusCode === 200) {
      const pdf = await c.inject(`/api/projects/${pid}/compile/${compile.json().job.id}/output.pdf`);
      expect(pdf.statusCode).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
    }
  });

  it.each(ALL)('write endpoints for %s', async (who) => {
    const c = clients[who];
    expectStatus(who, (await c.inject({ method: 'POST', url: `/api/projects/${pid}/files`, payload: { path: `${who}.tex` } })).statusCode, WRITE[who]);
    expectStatus(who, (await c.inject({ method: 'PUT', url: `/api/projects/${pid}/files/${mainId}/content`, payload: { content: 'x' } })).statusCode, WRITE[who]);
    expectStatus(who, (await c.inject({ method: 'POST', url: `/api/projects/${pid}/upload`, ...multipart([{ name: `${who}.bib`, data: '@misc{a}' }]) })).statusCode, WRITE[who]);
    expectStatus(who, (await c.inject({ method: 'PATCH', url: `/api/projects/${pid}`, payload: { compiler: 'lualatex' } })).statusCode, WRITE[who]);
    expectStatus(who, (await c.inject({ method: 'POST', url: `/api/projects/${pid}/folders/rename`, payload: { from: 'bolimlar', to: `b_${who}` } })).statusCode, WRITE[who]);
  });

  it.each(ALL)('owner-only endpoints for %s', async (who) => {
    const c = clients[who];
    expectStatus(who, (await c.inject({ method: 'PATCH', url: `/api/projects/${pid}`, payload: { name: 'Yangi nom' } })).statusCode, OWNER[who]);
    expectStatus(who, (await c.inject(`/api/projects/${pid}/share-links`)).statusCode, OWNER[who]);
    expectStatus(who, (await c.inject({ method: 'POST', url: `/api/projects/${pid}/share-links`, payload: { role: 'editor' } })).statusCode, OWNER[who]);
    expectStatus(who, (await c.inject({ method: 'DELETE', url: `/api/projects/${pid}` })).statusCode, OWNER[who]);
  });

  it('viewers cannot modify files, but the file stays readable', async () => {
    const res = await clients.viewer.inject({ method: 'DELETE', url: `/api/projects/${pid}/files/${mainId}` });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('forbidden');
    expect((await ctx.api.inject(`/api/projects/${pid}/files/${mainId}`)).body).toContain('\\documentclass');
  });

  it('accepts the share token as a query parameter (for links and the PDF viewer)', async () => {
    const anon = ctx.client();
    expect((await anon.inject(`/api/projects/${pid}?share=${viewerToken}`)).statusCode).toBe(200);
    expect((await anon.inject(`/api/projects/${pid}/download.zip?share=${viewerToken}`)).statusCode).toBe(200);
  });

  it('does not let a token for one project open another', async () => {
    const other = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Boshqa' } })).json().project;
    expect((await clients.viewer.inject(`/api/projects/${other.id}`)).statusCode).toBe(404);
    expect((await clients.editor.inject({ method: 'DELETE', url: `/api/projects/${other.id}` })).statusCode).toBe(404);
  });

  it('lists only the projects a user owns', async () => {
    const own = (await clients.stranger.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Meniki' } })).json().project;
    expect((await clients.stranger.inject('/api/projects')).json().projects.map((p: { id: string }) => p.id)).toEqual([own.id]);
    expect((await ctx.api.inject('/api/projects')).json().projects.map((p: { id: string }) => p.id)).toEqual([pid]);
    expect((await ctx.api.inject(`/api/projects/${own.id}`)).statusCode).toBe(404);
  });
});

describe('share links', () => {
  let ctx: TestContext;
  let pid: string;
  beforeEach(async () => {
    ctx = await createTestContext(new FakeRunner());
    pid = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Algebra' } })).json().project.id;
  });
  afterEach(() => ctx.close());

  const create = (role: string) =>
    ctx.api.inject({ method: 'POST', url: `/api/projects/${pid}/share-links`, payload: { role } });

  it('creates, lists and revokes links', async () => {
    const viewer = (await create('viewer')).json().link;
    const editor = (await create('editor')).json().link;
    expect(viewer).toMatchObject({ role: 'viewer' });
    expect(viewer.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(viewer.token).not.toBe(editor.token);
    expect((await create('owner')).statusCode).toBe(400);

    const list = (await ctx.api.inject(`/api/projects/${pid}/share-links`)).json().links;
    expect(list.map((l: { id: string }) => l.id)).toEqual([viewer.id, editor.id]);

    expect((await ctx.api.inject({ method: 'DELETE', url: `/api/projects/${pid}/share-links/${viewer.id}` })).statusCode).toBe(204);
    expect((await ctx.api.inject({ method: 'DELETE', url: `/api/projects/${pid}/share-links/${viewer.id}` })).statusCode).toBe(404);
    expect((await ctx.api.inject(`/api/projects/${pid}/share-links`)).json().links).toHaveLength(1);

    // A revoked link no longer opens anything.
    const holder = ctx.client(viewer.token);
    expect((await holder.inject(`/api/projects/${pid}`)).statusCode).toBe(404);
    expect((await holder.inject(`/api/share/${viewer.token}`)).statusCode).toBe(404);
  });

  it('resolves a link to the project and the effective role', async () => {
    const viewer = (await create('viewer')).json().link.token;
    const editor = (await create('editor')).json().link.token;
    const anon = ctx.client();
    expect((await anon.inject(`/api/share/${viewer}`)).json().share).toEqual({
      projectId: pid,
      projectName: 'Algebra',
      linkRole: 'viewer',
      role: 'viewer',
    });
    // Editor links need a login to edit.
    expect((await anon.inject(`/api/share/${editor}`)).json().share).toMatchObject({ linkRole: 'editor', role: 'viewer' });
    await anon.register('kolega@test.uz');
    expect((await anon.inject(`/api/share/${editor}`)).json().share).toMatchObject({ linkRole: 'editor', role: 'editor' });
    expect((await anon.inject('/api/share/unknown-token')).statusCode).toBe(404);
  });

  it('removes links together with the project', async () => {
    const token = (await create('viewer')).json().link.token;
    await ctx.api.inject({ method: 'DELETE', url: `/api/projects/${pid}` });
    expect(await ctx.prisma.shareLink.count()).toBe(0);
    expect((await ctx.client().inject(`/api/share/${token}`)).statusCode).toBe(404);
  });

  it('limits the number of active links', async () => {
    for (let i = 0; i < 20; i++) expect((await create('viewer')).statusCode).toBe(201);
    expect((await create('viewer')).json().error.code).toBe('too_many_links');
  });
});
