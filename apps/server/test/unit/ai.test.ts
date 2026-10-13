import { afterEach, describe, expect, it } from 'vitest';
import type { AiClient, AiCompletion, AiCompletionRequest } from '../../src/ai/ai-client.js';
import { AppError } from '../../src/errors.js';
import { loadsPackage, loadsTikzLibrary } from '../../src/ai/ai-service.js';
import { createTestContext, type TestContext } from '../helpers/context.js';
import { FakeRunner } from '../helpers/fake-runner.js';
import { multipart } from '../helpers/context.js';
import { loadBuiltInDesigns } from '../../src/designs/design-service.js';

/** Records requests and answers with a scripted JSON value. */
class FakeAiClient implements AiClient {
  requests: AiCompletionRequest[] = [];
  answer: (req: AiCompletionRequest) => unknown = () => ({ explanation: 'Tushuntirish' });

  async complete(req: AiCompletionRequest): Promise<AiCompletion> {
    this.requests.push(req);
    return { data: await this.answer(req), inputTokens: 100, outputTokens: 50 };
  }
}

const MAIN = [
  '\\documentclass{article}',
  '\\usepackage{amsmath}',
  '\\begin{document}',
  'Salom',
  '$\\frac{1}{2$ va \\badcommand',
  'Oxiri',
  '\\end{document}',
].join('\n');

/** A failed compile whose log points at main.tex line 5. */
function failingRunner(): FakeRunner {
  const runner = new FakeRunner();
  runner.result = () => ({
    status: 'failed',
    exitCode: 12,
    log: './main.tex:5: Undefined control sequence.\nl.5 $\\frac{1}{2$ va \\badcommand\n\n',
    console: '',
    pdf: null,
    synctex: null,
    errorMessage: null,
  });
  return runner;
}

async function setup(env: Record<string, string>, ai?: FakeAiClient) {
  const ctx = await createTestContext(failingRunner(), env, { aiClient: ai });
  const p = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'AI' } })).json().project;
  const files = (await ctx.api.inject(`/api/projects/${p.id}`)).json().project.files as Array<{ id: string; path: string }>;
  const mainId = files.find((f) => f.path === 'main.tex')!.id;
  await ctx.api.inject({ method: 'PUT', url: `/api/projects/${p.id}/files/${mainId}/content`, payload: { content: MAIN } });
  const job = (await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/compile`, payload: { wait: true } })).json().job;
  return { ctx, projectId: p.id as string, mainId: mainId as string, job };
}

describe('AI assistance', () => {
  let ctx: TestContext | undefined;
  afterEach(async () => {
    await ctx?.close();
    ctx = undefined;
  });

  it('is off by default: every AI route answers 404 and nothing is sent', async () => {
    const ai = new FakeAiClient();
    const s = await setup({}, ai);
    ctx = s.ctx;
    expect((await ctx.api.inject('/api/ai/status')).json().status).toEqual({ enabled: false, remaining: null, dailyLimit: null });
    for (const [kind, payload] of [
      ['explain', { jobId: s.job.id, entry: 0, lang: 'uz' }],
      ['fix', { jobId: s.job.id, entry: 0, lang: 'uz' }],
      ['exercises', { topic: 'Kasrlar', count: 3, level: 'easy', lang: 'uz' }],
      ['tikz', { description: 'Uchburchak', lang: 'uz' }],
    ] as const) {
      const res = await ctx.api.inject({ method: 'POST', url: `/api/projects/${s.projectId}/ai/${kind}`, payload });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('ai_disabled');
    }
    expect(ai.requests).toHaveLength(0);
    expect(await ctx.prisma.aiRequest.count()).toBe(0);
  });

  it('stays off when enabled without an API key', async () => {
    ctx = await createTestContext(new FakeRunner(), { AI_ENABLED: 'true' });
    expect((await ctx.api.inject('/api/ai/status')).json().status.enabled).toBe(false);
  });

  it('explains a compile error with the source around it, in the requested language', async () => {
    const ai = new FakeAiClient();
    const s = await setup({ AI_ENABLED: 'true' }, ai);
    ctx = s.ctx;
    expect(s.job.entries[0]).toMatchObject({ file: 'main.tex', line: 5, level: 'error' });
    const res = await ctx.api.inject({
      method: 'POST',
      url: `/api/projects/${s.projectId}/ai/explain`,
      payload: { jobId: s.job.id, entry: 0, lang: 'ru' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toEqual({ explanation: 'Tushuntirish' });
    const req = ai.requests[0]!;
    expect(req.system).toContain('на русском');
    expect(req.prompt).toContain('Undefined control sequence');
    expect(req.prompt).toContain('5: $\\frac{1}{2$ va \\badcommand');
    expect(req.schema).toMatchObject({ required: ['explanation'] });
    const row = await ctx.prisma.aiRequest.findFirstOrThrow();
    expect(row).toMatchObject({ kind: 'explain', projectId: s.projectId, inputTokens: 100, outputTokens: 50, ok: true });

    // Unknown entry and invalid language are rejected without calling the model.
    expect((await ctx.api.inject({ method: 'POST', url: `/api/projects/${s.projectId}/ai/explain`, payload: { jobId: s.job.id, entry: 9, lang: 'uz' } })).statusCode).toBe(404);
    expect((await ctx.api.inject({ method: 'POST', url: `/api/projects/${s.projectId}/ai/explain`, payload: { jobId: s.job.id, entry: 0, lang: 'de' } })).statusCode).toBe(400);
    expect(ai.requests).toHaveLength(1);
  });

  it('suggests a fix as a replacement of the excerpt around the error', async () => {
    const ai = new FakeAiClient();
    ai.answer = (req) => {
      const excerpt = /<excerpt>\n([\s\S]*)\n<\/excerpt>/.exec(req.prompt)![1]!;
      return { replacement: excerpt.replace('{2$ va \\badcommand', '{2}$ va') + '\n', explanation: 'Qavs yopildi.' };
    };
    const s = await setup({ AI_ENABLED: 'true' }, ai);
    ctx = s.ctx;
    const res = await ctx.api.inject({
      method: 'POST',
      url: `/api/projects/${s.projectId}/ai/fix`,
      payload: { jobId: s.job.id, entry: 0, lang: 'uz' },
    });
    expect(res.statusCode).toBe(200);
    const fix = res.json().result;
    expect(fix).toMatchObject({ fileId: s.mainId, path: 'main.tex', startLine: 1, endLine: 7, explanation: 'Qavs yopildi.' });
    expect(fix.original).toBe(MAIN);
    expect(fix.suggestion).toBe(MAIN.replace('{2$ va \\badcommand', '{2}$ va')); // trailing newline dropped
    expect(ai.requests[0]!.system).toContain('oʻzbek tilida');
  });

  it('generates exercises and TikZ pictures and lists missing preamble lines', async () => {
    const ai = new FakeAiClient();
    ai.answer = (req) =>
      req.schema.required && (req.schema.required as string[]).includes('libraries')
        ? { latex: '\\begin{tikzpicture}\\draw[->] (0,0) -- (1,1);\\end{tikzpicture}', libraries: ['arrows.meta', 'bad lib;'] }
        : { latex: '\\begin{enumerate}\\item $1+1$\\end{enumerate}' };
    const s = await setup({ AI_ENABLED: 'true' }, ai);
    ctx = s.ctx;
    const ex = await ctx.api.inject({
      method: 'POST',
      url: `/api/projects/${s.projectId}/ai/exercises`,
      payload: { topic: 'Kasrlarni qoʻshish', count: 5, level: 'medium', lang: 'en' },
    });
    expect(ex.json().result).toEqual({
      latex: '\\begin{enumerate}\\item $1+1$\\end{enumerate}',
      preambleAdditions: ['\\usepackage{amssymb}'],
    });
    expect(ai.requests[0]!.prompt).toContain('Number of exercises: 5');
    expect(ai.requests[0]!.prompt).toContain('Difficulty: medium');

    const tikz = await ctx.api.inject({
      method: 'POST',
      url: `/api/projects/${s.projectId}/ai/tikz`,
      payload: { description: 'Toʻgʻri burchakli uchburchak', lang: 'uz' },
    });
    expect(tikz.json().result.preambleAdditions).toEqual(['\\usepackage{tikz}', '\\usetikzlibrary{arrows.meta}']);

    ai.answer = () => ({ latex: 'not a picture', libraries: [] });
    const bad = await ctx.api.inject({
      method: 'POST',
      url: `/api/projects/${s.projectId}/ai/tikz`,
      payload: { description: 'Doira', lang: 'uz' },
    });
    expect(bad.statusCode).toBe(502);
    // The failed answer is not charged.
    expect(await ctx.prisma.aiRequest.count()).toBe(2);
  });

  it('enforces the per-user daily quota, with a per-user override', async () => {
    const ai = new FakeAiClient();
    const s = await setup({ AI_ENABLED: 'true', AI_DAILY_LIMIT: '2' }, ai);
    ctx = s.ctx;
    const explain = () =>
      ctx!.api.inject({ method: 'POST', url: `/api/projects/${s.projectId}/ai/explain`, payload: { jobId: s.job.id, entry: 0, lang: 'uz' } });
    expect((await ctx.api.inject('/api/ai/status')).json().status).toEqual({ enabled: true, remaining: 2, dailyLimit: 2 });
    // Concurrent requests cannot overshoot the limit.
    const results = await Promise.all([explain(), explain(), explain()]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 200, 429]);
    expect(results.find((r) => r.statusCode === 429)!.json().error.code).toBe('ai_quota');
    expect(ai.requests).toHaveLength(2);
    expect((await ctx.api.inject('/api/ai/status')).json().status.remaining).toBe(0);

    await ctx.prisma.user.updateMany({ where: { email: 'owner@test.uz' }, data: { aiDailyLimit: 3 } });
    expect((await explain()).statusCode).toBe(200);
    expect((await explain()).statusCode).toBe(429);
  });

  it('does not count requests the provider failed or refused as successful', async () => {
    const ai = new FakeAiClient();
    const s = await setup({ AI_ENABLED: 'true', AI_DAILY_LIMIT: '5' }, ai);
    ctx = s.ctx;
    const explain = () =>
      ctx!.api.inject({ method: 'POST', url: `/api/projects/${s.projectId}/ai/explain`, payload: { jobId: s.job.id, entry: 0, lang: 'uz' } });
    ai.answer = () => {
      throw new AppError(502, 'ai_unavailable', 'down');
    };
    expect((await explain()).statusCode).toBe(502);
    expect(await ctx.prisma.aiRequest.count()).toBe(0);
    ai.answer = () => {
      throw new AppError(422, 'ai_refused', 'no');
    };
    expect((await explain()).json().error.code).toBe('ai_refused');
    expect(await ctx.prisma.aiRequest.findFirstOrThrow()).toMatchObject({ ok: false });
  });

  it('checks access: anonymous users, strangers and viewers', async () => {
    const ai = new FakeAiClient();
    const s = await setup({ AI_ENABLED: 'true' }, ai);
    ctx = s.ctx;
    const link = (await ctx.api.inject({ method: 'POST', url: `/api/projects/${s.projectId}/share-links`, payload: { role: 'viewer' } })).json().link;
    const explainBody = { jobId: s.job.id, entry: 0, lang: 'uz' };
    const tikzBody = { description: 'Kvadrat', lang: 'uz' };

    // Anonymous (even with a link): quota is per user, so login is required.
    const anon = ctx.client(link.token);
    expect((await anon.inject({ method: 'POST', url: `/api/projects/${s.projectId}/ai/explain`, payload: explainBody })).statusCode).toBe(401);

    const stranger = ctx.client();
    await stranger.register('stranger@test.uz');
    expect((await stranger.inject({ method: 'POST', url: `/api/projects/${s.projectId}/ai/explain`, payload: explainBody })).statusCode).toBe(404);

    const viewer = ctx.client(link.token);
    await viewer.register('viewer@test.uz');
    expect((await viewer.inject({ method: 'POST', url: `/api/projects/${s.projectId}/ai/explain`, payload: explainBody })).statusCode).toBe(200);
    expect((await viewer.inject({ method: 'POST', url: `/api/projects/${s.projectId}/ai/fix`, payload: explainBody })).statusCode).toBe(403);
    expect((await viewer.inject({ method: 'POST', url: `/api/projects/${s.projectId}/ai/tikz`, payload: tikzBody })).statusCode).toBe(403);
    expect(ai.requests).toHaveLength(1);
  });

  it('recognises packages and TikZ libraries in the preamble', () => {
    const pre = '\\usepackage[utf8]{inputenc}\n\\usepackage{amsmath, tikz}\n% \\usepackage{amssymb}\n\\usetikzlibrary{calc,arrows.meta}';
    expect(loadsPackage(pre, 'tikz')).toBe(true);
    expect(loadsPackage(pre, 'amsmath')).toBe(true);
    expect(loadsPackage(pre, 'amssymb')).toBe(false);
    expect(loadsTikzLibrary(pre, 'arrows.meta')).toBe(true);
    expect(loadsTikzLibrary(pre, 'positioning')).toBe(false);
  });

  it('uses the design helpers in documents that load the design package', async () => {
    const ai = new FakeAiClient();
    ai.answer = () => ({ latex: '\\begin{koordinata}\\addplot {x^2};\\end{koordinata}', libraries: ['calc', 'mindmap'] });
    ctx = await createTestContext(new FakeRunner(), { AI_ENABLED: 'true' }, { aiClient: ai });
    const p = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'D', template: 'textbook' } })).json().project;
    const res = await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/ai/tikz`, payload: { description: 'Parabola', lang: 'uz' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.preambleAdditions).toEqual(['\\usetikzlibrary{mindmap}']);
    expect(ai.requests[0]!.system).toContain('\\begin{koordinata}');
    expect(ai.requests[0]!.system).toContain('\\uchburchak');
  });

  it('proposes a design from pages of a book', async () => {
    const spec = loadBuiltInDesigns('designs')[0]!.spec;
    const ai = new FakeAiClient();
    ai.answer = () => ({ name: 'Kitobdagidek', notes: 'Ranglar sarlavhalardan olindi.', spec: { ...spec, colors: { ...spec.colors, primary: '#123456' } } });
    ctx = await createTestContext(new FakeRunner(), { AI_ENABLED: 'true' }, { aiClient: ai });
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100, 32)]);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50)]);
    const upload = multipart([{ name: 'kitob.pdf', data: pdf }, { name: 'sahifa.png', data: png }]);
    const res = await ctx.api.inject({ method: 'POST', url: '/api/ai/design-from-book?wishes=yorqinroq&lang=ru', ...upload });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({ name: 'Kitobdagidek', spec: { colors: { primary: '#123456' } } });
    const req = ai.requests[0]!;
    expect(req.attachments!.map((a) => a.mediaType)).toEqual(['application/pdf', 'image/png']);
    expect(Buffer.from(req.attachments![0]!.data, 'base64').equals(pdf)).toBe(true);
    expect(req.system).toContain('дизайнер');
    expect(req.prompt).toContain('<wishes>\nyorqinroq\n</wishes>');
    expect(req.prompt).toContain('Noto Serif');
    expect(await ctx.prisma.aiRequest.findFirstOrThrow()).toMatchObject({ kind: 'design', projectId: null });

    // Not a PDF or an image; an invalid design answer is not charged.
    const bad = multipart([{ name: 'x.pdf', data: '<script>' }]);
    expect((await ctx.api.inject({ method: 'POST', url: '/api/ai/design-from-book', ...bad })).json().error.code).toBe('book_file_type');
    ai.answer = () => ({ name: 'x', notes: '', spec: { ...spec, colors: { ...spec.colors, primary: 'red' } } });
    const invalid = await ctx.api.inject({ method: 'POST', url: '/api/ai/design-from-book', ...multipart([{ name: 'k.pdf', data: pdf }]) });
    expect(invalid.statusCode).toBe(502);
    expect(await ctx.prisma.aiRequest.count()).toBe(1);
    expect((await ctx.client().inject({ method: 'POST', url: '/api/ai/design-from-book', ...multipart([{ name: 'k.pdf', data: pdf }]) })).statusCode).toBe(401);
  });

  it('design from a book is off with the rest of AI', async () => {
    ctx = await createTestContext(new FakeRunner(), {}, { aiClient: new FakeAiClient() });
    const res = await ctx.api.inject({ method: 'POST', url: '/api/ai/design-from-book', ...multipart([{ name: 'k.pdf', data: '%PDF-1' }]) });
    expect(res.json().error.code).toBe('ai_disabled');
  });
});
