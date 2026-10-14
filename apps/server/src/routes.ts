import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { COMPILERS, SHARE_ROLES, SPELL_LANGUAGES } from '@oversells/shared';
import { AppError, badRequest, notFound } from './errors.js';
import { babelForScript, bosmaSty, generateTest, transliterateLatex, isbnDigits, parseBank, PRINT_FORMATS, TESTLAR_STY } from '@oversells/shared';
import { newId } from './ids.js';
import { parse } from './validation.js';
import { toCompileJobDTO, toFileDTO, toProjectDTO } from './dto.js';
import type { ProjectService } from './projects/project-service.js';
import type { FileService } from './files/file-service.js';
import type { CompileService } from './compile/compile-service.js';
import type { CompileRunner } from './compile/runner.js';
import type { Storage } from './storage/storage.js';
import type { AccessNeed, AccessService } from './access/access-service.js';
import { toShareLinkDTO, type ShareService } from './share/share-service.js';
import { toTemplateDTO, type TemplateStore } from './projects/templates.js';
import type { TemplatePreviewService } from './templates/preview-service.js';
import { requireUser } from './auth/http.js';
import type { DocManager } from './collab/doc-manager.js';
import { toVersionDTO, type VersionService } from './versions/version-service.js';
import type { CommentService } from './comments/comment-service.js';
import type { SyncTexService } from './synctex/synctex-service.js';
import type { QuotaService } from './admin/quotas.js';
import type { DesignService } from './designs/design-service.js';
import { contentDisposition, zipProject } from './projects/zip.js';

export interface Services {
  projects: ProjectService;
  files: FileService;
  compile: CompileService;
  /** Null in queue mode (the compile worker service owns the sandbox). */
  runner: CompileRunner | null;
  /** Inline: the sandbox check; queue: whether a compile worker is alive. */
  compilerStatus(): Promise<{ ok: boolean; message: string }>;
  storage: Storage;
  access: AccessService;
  shares: ShareService;
  templates: TemplateStore;
  previews: TemplatePreviewService;
  docs: DocManager;
  versions: VersionService;
  comments: CommentService;
  synctex: SyncTexService;
  quotas: QuotaService;
  designs: DesignService;
  prisma: PrismaClient;
  maxTextFileBytes: number;
  maxUploadBytes: number;
}

const idParams = z.object({ id: z.string().min(1).max(64) });
const fileParams = idParams.extend({ fileId: z.string().min(1).max(64) });
const jobParams = idParams.extend({ jobId: z.string().min(1).max(64) });
const linkParams = idParams.extend({ linkId: z.string().min(1).max(64) });

const createProjectBody = z.object({
  name: z.string(),
  template: z.string().max(64).optional(),
  compiler: z.enum(COMPILERS).optional(),
});
const updateProjectBody = z
  .object({
    name: z.string().optional(),
    compiler: z.enum(COMPILERS).optional(),
    mainFile: z.string().optional(),
    spellLanguage: z.enum(SPELL_LANGUAGES).optional(),
  })
  .strict();

/** Headers for serving user-provided content: never sniff, never execute. */
const SAFE_CONTENT_HEADERS = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
};

/**
 * Share token of the request: the X-Share-Token header (API calls) or the
 * `share` query parameter (links and <img>/PDF URLs, which cannot set headers).
 */
export function shareTokenOf(req: FastifyRequest): string | null {
  const header = req.headers['x-share-token'];
  if (typeof header === 'string' && header) return header;
  const query = req.query as Record<string, unknown> | undefined;
  return typeof query?.share === 'string' && query.share ? query.share : null;
}

export async function registerRoutes(app: FastifyInstance, s: Services): Promise<void> {
  /** Checks access to the project in the route's `:id` parameter. */
  const access = (req: FastifyRequest, id: string, need: AccessNeed) =>
    s.access.require(req.user, shareTokenOf(req), id, need);

  /** Liveness (the process answers) plus the compiler state; see /api/ready for dependencies. */
  app.get('/api/health', async () => {
    const compiler = await s.compilerStatus();
    return { status: 'ok', compiler };
  });

  // --- templates (public) --------------------------------------------------

  app.get('/api/templates', async () => ({ templates: (await s.templates.list()).map(toTemplateDTO) }));

  app.get('/api/templates/:name/preview.png', async (req, reply) => {
    const { name } = parse(z.object({ name: z.string().min(1).max(64) }), req.params);
    const png = await s.previews.preview(name);
    if (!png) throw notFound('Template preview');
    reply.header('content-type', 'image/png').header('cache-control', 'public, max-age=3600');
    return reply.send(png);
  });

  // --- projects ------------------------------------------------------------

  app.get('/api/projects', async (req) => {
    const user = requireUser(req.user);
    const projects = await s.projects.list(user.id);
    return { projects: projects.map(toProjectDTO) };
  });

  // --- personal spell-check dictionary ---------------------------------------------

  const wordSchema = z.string().trim().min(1).max(100).regex(/^[\p{L}\p{M}'’‘ʻʼ`-]+$/u, 'Not a word');

  app.get('/api/me/dictionary', async (req) => {
    const user = requireUser(req.user);
    const words = await s.prisma.userWord.findMany({ where: { userId: user.id }, orderBy: { word: 'asc' } });
    return { words: words.map((w) => w.word) };
  });

  app.post('/api/me/dictionary', async (req, reply) => {
    const user = requireUser(req.user);
    const { word } = parse(z.object({ word: wordSchema }), req.body);
    if ((await s.prisma.userWord.count({ where: { userId: user.id } })) >= 5000) {
      throw badRequest('too_many_words', 'Your dictionary is full');
    }
    await s.prisma.userWord.upsert({
      where: { userId_word: { userId: user.id, word: word.normalize('NFC') } },
      create: { userId: user.id, word: word.normalize('NFC') },
      update: {},
    });
    reply.code(201);
    return { word: word.normalize('NFC') };
  });

  app.delete('/api/me/dictionary/:word', async (req, reply) => {
    const user = requireUser(req.user);
    const { word } = parse(z.object({ word: wordSchema }), req.params);
    await s.prisma.userWord.deleteMany({ where: { userId: user.id, word: word.normalize('NFC') } });
    reply.code(204);
  });

  /** Projects other people shared with the user through links they opened. */
  app.get('/api/projects/shared', async (req) => {
    const user = requireUser(req.user);
    return { projects: await s.shares.sharedWith(user) };
  });

  app.post('/api/projects', async (req, reply) => {
    const user = requireUser(req.user);
    const body = parse(createProjectBody, req.body);
    await s.quotas.assertCanCreateProject(user);
    const project = await s.projects.create(user.id, body);
    reply.code(201);
    return { project: toProjectDTO(project) };
  });

  app.get('/api/projects/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const { role } = await access(req, id, 'read');
    const project = await s.projects.getWithFiles(id);
    return { project: { ...toProjectDTO(project), files: project.files.map(toFileDTO), access: role } };
  });

  app.patch('/api/projects/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(updateProjectBody, req.body ?? {});
    // Renaming is the owner's call; editors may change compiler and main file.
    await access(req, id, body.name !== undefined ? 'owner' : 'write');
    return { project: toProjectDTO(await s.projects.update(id, body)) };
  });

  app.delete('/api/projects/:id', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    await access(req, id, 'owner');
    await s.docs.dropProject(id);
    await s.projects.delete(id);
    reply.code(204);
  });

  app.get('/api/projects/:id/download.zip', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    await access(req, id, 'read');
    await s.docs.flushProject(id);
    const project = await s.projects.getWithFiles(id);
    reply
      .header('content-type', 'application/zip')
      .header('referrer-policy', 'no-referrer')
      .header('content-disposition', contentDisposition('attachment', `${project.name}.zip`));
    return reply.send(zipProject(project.files, s.storage));
  });

  // --- Word / EPUB (pandoc in the sandbox) -----------------------------------------

  /** A Word document becomes a new project: main.tex plus its pictures in media/. */
  app.post('/api/projects/import-docx', async (req, reply) => {
    const user = requireUser(req.user);
    if (!req.isMultipart()) throw badRequest('invalid_request', 'Expected multipart/form-data');
    const part = await req.file();
    if (!part) throw badRequest('no_files', 'No file was uploaded');
    const data = await part.toBuffer();
    // A .docx is a ZIP archive.
    if (!/\.docx$/i.test(part.filename) || data.subarray(0, 2).toString('latin1') !== 'PK') {
      throw badRequest('not_docx', 'Expected a Word (.docx) file');
    }
    await s.quotas.assertCanCreateProject(user);
    const converted = await s.compile.convert(`import-${newId()}`, [{ path: 'input.docx', data }], 'docx-to-latex');
    const main = converted.files.find((f) => f.path === 'main.tex');
    if (converted.status !== 'success' || !main) {
      throw new AppError(422, 'convert_failed', 'The Word document could not be converted');
    }
    const name = part.filename.replace(/\.docx$/i, '').trim().slice(0, 200) || 'Word';
    const project = await s.projects.create(user.id, { name, template: 'blank' });
    try {
      for (const f of converted.files) {
        const slash = f.path.lastIndexOf('/');
        await s.files.upload(project.id, slash === -1 ? '' : f.path.slice(0, slash), f.path.slice(slash + 1), f.data, true);
      }
    } catch (err) {
      await s.projects.delete(project.id).catch(() => undefined);
      throw err;
    }
    reply.code(201);
    return { project: toProjectDTO(project) };
  });

  app.get('/api/projects/:id/export/:format', async (req, reply) => {
    const { id, format } = parse(z.object({ id: z.string().min(1).max(64), format: z.enum(['docx', 'epub']) }), req.params);
    await access(req, id, 'read');
    await s.docs.flushProject(id);
    const project = await s.projects.getWithFiles(id);
    const files = await Promise.all(project.files.map(async (f) => ({ path: f.path, data: await s.storage.get(f.storageKey) })));
    const mode = format === 'docx' ? 'latex-to-docx' : 'latex-to-epub';
    const converted = await s.compile.convert(`export-${newId()}`, files, mode, project.mainFile);
    const out = converted.files.find((f) => f.path === `output.${format}`);
    if (converted.status !== 'success' || !out) {
      throw new AppError(422, 'convert_failed', 'The project could not be converted');
    }
    reply
      .header('content-type', format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/epub+zip')
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', contentDisposition('attachment', `${project.name}.${format}`));
    return reply.send(out.data);
  });

  // --- tests from a question bank ---------------------------------------------------

  /** Writes test.tex (variants, answer sheet, key) and testlar.sty from a bank file; test.tex becomes the main file. */
  app.post('/api/projects/:id/test', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({
        bank: z.string().min(1).max(500),
        title: z.string().trim().max(200).default(''),
        variants: z.number().int().min(1).max(26).default(4),
        shuffleQuestions: z.boolean().default(true),
        shuffleOptions: z.boolean().default(true),
        answerSheet: z.boolean().default(true),
        answerKey: z.boolean().default(true),
        seed: z.number().int().min(0).max(2 ** 31).optional(),
      }),
      req.body,
    );
    await access(req, id, 'write');
    const project = await s.projects.getWithFiles(id);
    const bank = project.files.find((f) => f.path === body.bank && f.kind === 'text');
    if (!bank) throw notFound('Question bank');
    const { questions, problems } = parseBank(await s.docs.getText(bank.id));
    if (questions.length === 0) throw new AppError(422, 'no_questions', 'The file has no usable \\begin{savol} questions');
    const test = generateTest(questions, {
      ...body,
      seed: body.seed ?? Math.floor(Math.random() * 2 ** 31),
      design: project.files.some((f) => f.path === 'dizayn.sty'),
    });
    const write = async (path: string, text: string) => {
      const existing = project.files.find((f) => f.path === path);
      return existing ? s.files.saveText(id, existing.id, text) : s.files.createText(id, path, text);
    };
    await write('testlar.sty', TESTLAR_STY);
    const file = await write('test.tex', test.tex);
    const updated = await s.projects.update(id, { mainFile: 'test.tex' });
    await s.projects.touch(id);
    return { questions: questions.length, problems, key: test.key, file: toFileDTO(file), project: toProjectDTO(updated) };
  });

  // --- print settings (bosma.sty) ---------------------------------------------------

  const PRINT_LINE = '\\usepackage{bosma} % Bosmaxona sozlamalari (bosma.sty)';
  /** Loads bosma.sty right after \\documentclass, or removes that line. */
  const setPrintLine = async (projectId: string, on: boolean) => {
    const project = await s.projects.getWithFiles(projectId);
    const main = project.files.find((f) => f.path === project.mainFile && f.kind === 'text');
    if (!main) return false;
    const text = await s.docs.getText(main.id);
    const loads = /^[^%\n]*\\usepackage\s*(\[[^\]]*\])?\s*\{bosma\}.*\n?/m;
    let next: string | null = null;
    if (on && !loads.test(text)) {
      const m = /^[ \t]*\\documentclass(\[[^\]]*\])?\{[^}]*\}.*$/m.exec(text);
      if (m) next = `${text.slice(0, m.index + m[0].length)}\n${PRINT_LINE}${text.slice(m.index + m[0].length)}`;
    } else if (!on && loads.test(text)) {
      next = text.replace(loads, '');
    }
    return next === null ? false : s.docs.setText(main.id, next);
  };

  app.post('/api/projects/:id/print', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({
        format: z.enum(PRINT_FORMATS.map((f) => f.id) as [string, ...string[]]),
        marks: z.boolean(),
        cmyk: z.boolean(),
        isbn: z.string().trim().max(30).optional(),
      }),
      req.body,
    );
    await access(req, id, 'write');
    if (body.isbn && !isbnDigits(body.isbn)) throw badRequest('invalid_isbn', 'Not a valid ISBN-13');
    const project = await s.projects.getWithFiles(id);
    const sty = bosmaSty({ ...body, isbn: body.isbn || undefined });
    const existing = project.files.find((f) => f.path === 'bosma.sty');
    const file = existing ? await s.files.saveText(id, existing.id, sty) : await s.files.createText(id, 'bosma.sty', sty);
    const mainChanged = await setPrintLine(id, true);
    await s.projects.touch(id);
    return { file: toFileDTO(file), mainChanged };
  });

  app.delete('/api/projects/:id/print', async (req) => {
    const { id } = parse(idParams, req.params);
    await access(req, id, 'write');
    const mainChanged = await setPrintLine(id, false);
    await s.projects.touch(id);
    return { mainChanged };
  });

  // --- Latin <-> Cyrillic ---------------------------------------------------------------

  /** Changes the script of every .tex file; a named version is kept first, so it can be undone. */
  app.post('/api/projects/:id/transliterate', async (req) => {
    const user = requireUser(req.user);
    const { id } = parse(idParams, req.params);
    const { to } = parse(z.object({ to: z.enum(['latn', 'cyrl']) }), req.body);
    await access(req, id, 'write');
    await s.docs.flushProject(id);
    await s.versions.snapshot(id, 'named', to === 'cyrl' ? 'Kirillga oʻtkazishdan oldin' : 'Lotinga oʻtkazishdan oldin', user);
    const project = await s.projects.getWithFiles(id);
    let changed = 0;
    for (const f of project.files) {
      if (f.kind !== 'text' || !/\.(tex|ltx)$/i.test(f.path)) continue;
      const text = await s.docs.getText(f.id);
      let next = transliterateLatex(text, to);
      if (f.path === project.mainFile) next = babelForScript(next, to);
      if (next !== text && (await s.docs.setText(f.id, next))) changed++;
    }
    const lang = to === 'cyrl' ? 'uz-cyrl' : 'uz-latn';
    await s.projects.update(id, { spellLanguage: lang });
    // The design's titles (Teorema / Теорема) follow the script.
    if (project.designId) {
      await s.designs.apply(id, project.designId, lang, user, s.files, s.docs).catch(() => undefined);
    }
    await s.projects.touch(id);
    return { changed };
  });

  // --- share links (owner only) ----------------------------------------------

  app.get('/api/projects/:id/share-links', async (req) => {
    const { id } = parse(idParams, req.params);
    await access(req, id, 'owner');
    return { links: (await s.shares.list(id)).map(toShareLinkDTO) };
  });

  app.post('/api/projects/:id/share-links', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ role: z.enum(SHARE_ROLES) }), req.body);
    await access(req, id, 'owner');
    const link = await s.shares.create(id, body.role, requireUser(req.user));
    reply.code(201);
    return { link: toShareLinkDTO(link) };
  });

  app.delete('/api/projects/:id/share-links/:linkId', async (req, reply) => {
    const { id, linkId } = parse(linkParams, req.params);
    await access(req, id, 'owner');
    const token = await s.shares.revoke(id, linkId);
    // Live editing sessions opened with this link end now.
    s.docs.closeConnections({ shareToken: token }, 4403, 'share link revoked');
    reply.code(204);
  });

  /** Opening a share link: tells the client which project and role it grants. */
  app.get('/api/share/:token', async (req) => {
    const { token } = parse(z.object({ token: z.string().min(1).max(64) }), req.params);
    return { share: await s.shares.resolve(token, req.user) };
  });

  // --- files ---------------------------------------------------------------

  app.post('/api/projects/:id/files', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ path: z.string(), content: z.string().optional() }), req.body);
    await access(req, id, 'write');
    const file = await s.files.createText(id, body.path, body.content ?? '');
    await s.projects.touch(id);
    reply.code(201);
    return { file: toFileDTO(file) };
  });

  app.post('/api/projects/:id/upload', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const query = parse(
      z.object({ folder: z.string().optional(), overwrite: z.enum(['true', 'false', '1', '0']).optional() }),
      req.query,
    );
    await access(req, id, 'write');
    if (!req.isMultipart()) throw badRequest('invalid_request', 'Expected multipart/form-data');
    const overwrite = query.overwrite === 'true' || query.overwrite === '1';
    const uploaded = [];
    for await (const part of req.files()) {
      const data = await part.toBuffer(); // throws when larger than the multipart fileSize limit
      uploaded.push(await s.files.upload(id, query.folder ?? '', part.filename, data, overwrite));
    }
    if (uploaded.length === 0) throw badRequest('no_files', 'No files were uploaded');
    await s.projects.touch(id);
    reply.code(201);
    return { files: uploaded.map(toFileDTO) };
  });

  app.get('/api/projects/:id/files/:fileId', async (req, reply) => {
    const { id, fileId } = parse(fileParams, req.params);
    await access(req, id, 'read');
    const { file, data } = await s.files.read(id, fileId);
    const name = file.path.slice(file.path.lastIndexOf('/') + 1);
    reply
      .headers(SAFE_CONTENT_HEADERS)
      .header('content-type', file.kind === 'text' ? 'text/plain; charset=utf-8' : file.mimeType)
      .header('content-disposition', contentDisposition('inline', name));
    return reply.send(data);
  });

  app.put(
    '/api/projects/:id/files/:fileId/content',
    { bodyLimit: s.maxTextFileBytes * 2 + 64 * 1024 },
    async (req) => {
      const { id, fileId } = parse(fileParams, req.params);
      const body = parse(z.object({ content: z.string() }), req.body);
      await access(req, id, 'write');
      const file = await s.files.saveText(id, fileId, body.content);
      await s.projects.touch(id);
      return { file: toFileDTO(file) };
    },
  );

  app.patch('/api/projects/:id/files/:fileId', async (req) => {
    const { id, fileId } = parse(fileParams, req.params);
    const body = parse(z.object({ path: z.string() }), req.body);
    await access(req, id, 'write');
    const file = await s.files.move(id, fileId, body.path);
    await s.projects.touch(id);
    return { file: toFileDTO(file) };
  });

  app.delete('/api/projects/:id/files/:fileId', async (req, reply) => {
    const { id, fileId } = parse(fileParams, req.params);
    await access(req, id, 'write');
    await s.files.delete(id, fileId);
    await s.projects.touch(id);
    reply.code(204);
  });

  app.post('/api/projects/:id/folders/rename', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ from: z.string(), to: z.string() }), req.body);
    await access(req, id, 'write');
    const moved = await s.files.renameFolder(id, body.from, body.to);
    await s.projects.touch(id);
    return { moved };
  });

  app.delete('/api/projects/:id/folders', async (req) => {
    const { id } = parse(idParams, req.params);
    const { path } = parse(z.object({ path: z.string() }), req.query);
    await access(req, id, 'write');
    const deleted = await s.files.deleteFolder(id, path);
    await s.projects.touch(id);
    return { deleted };
  });

  // --- comments (viewers read, editors and owner write) ---------------------------

  const commentParams = idParams.extend({ commentId: z.string().min(1).max(64) });

  app.get('/api/projects/:id/comments', async (req) => {
    const { id } = parse(idParams, req.params);
    const { fileId } = parse(z.object({ fileId: z.string().max(64).optional() }), req.query);
    await access(req, id, 'read');
    return { comments: await s.comments.list(id, fileId) };
  });

  app.post('/api/projects/:id/comments', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({ fileId: z.string().max(64), anchorStart: z.string(), anchorEnd: z.string(), body: z.string() }),
      req.body,
    );
    await access(req, id, 'write');
    reply.code(201);
    return { comment: await s.comments.create(id, requireUser(req.user), body) };
  });

  app.post('/api/projects/:id/comments/:commentId/replies', async (req, reply) => {
    const { id, commentId } = parse(commentParams, req.params);
    const body = parse(z.object({ body: z.string() }), req.body);
    await access(req, id, 'write');
    reply.code(201);
    return { comment: await s.comments.reply(id, requireUser(req.user), commentId, body.body) };
  });

  app.patch('/api/projects/:id/comments/:commentId', async (req) => {
    const { id, commentId } = parse(commentParams, req.params);
    const body = parse(z.object({ resolved: z.boolean() }), req.body);
    await access(req, id, 'write');
    return { comment: await s.comments.setResolved(id, requireUser(req.user), commentId, body.resolved) };
  });

  app.delete('/api/projects/:id/comments/:commentId', async (req, reply) => {
    const { id, commentId } = parse(commentParams, req.params);
    const { role } = await access(req, id, 'write');
    await s.comments.delete(id, requireUser(req.user), commentId, role === 'owner');
    reply.code(204);
  });

  // --- versions (viewers read, editors and owner save and restore) -----------------

  const versionParams = idParams.extend({ versionId: z.string().min(1).max(64) });

  app.get('/api/projects/:id/versions', async (req) => {
    const { id } = parse(idParams, req.params);
    await access(req, id, 'read');
    return { versions: (await s.versions.list(id)).map(toVersionDTO) };
  });

  app.post('/api/projects/:id/versions', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ name: z.string().trim().min(1).max(200) }), req.body);
    await access(req, id, 'write');
    const version = await s.versions.snapshot(id, 'named', body.name, requireUser(req.user));
    reply.code(201);
    return { version: toVersionDTO(version!) };
  });

  /** Current text of all text files, for comparing with a version. */
  app.get('/api/projects/:id/versions/current', async (req) => {
    const { id } = parse(idParams, req.params);
    await access(req, id, 'read');
    return { version: null, files: await s.versions.currentFiles(id) };
  });

  app.get('/api/projects/:id/versions/:versionId', async (req) => {
    const { id, versionId } = parse(versionParams, req.params);
    await access(req, id, 'read');
    return s.versions.content(id, versionId);
  });

  app.post('/api/projects/:id/versions/:versionId/restore', async (req) => {
    const { id, versionId } = parse(versionParams, req.params);
    await access(req, id, 'write');
    const version = await s.versions.restore(id, versionId, requireUser(req.user), s.files);
    await s.projects.touch(id);
    return { version: toVersionDTO(version) };
  });

  // --- compile (viewers may compile and download) ------------------------------

  app.post('/api/projects/:id/compile', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ wait: z.boolean().optional() }), req.body ?? {});
    await access(req, id, 'read');
    const { job, done } = await s.compile.request(id);
    if (body.wait) {
      return { job: toCompileJobDTO(await done) };
    }
    reply.code(202);
    return { job: toCompileJobDTO(job) };
  });

  app.get('/api/projects/:id/compile/latest', async (req) => {
    const { id } = parse(idParams, req.params);
    await access(req, id, 'read');
    const job = await s.compile.latest(id);
    return { job: job ? toCompileJobDTO(job) : null };
  });

  // ?wait=<seconds>&status=<known status>: long polling, answers as soon as the status changes.
  app.get('/api/projects/:id/compile/:jobId', async (req) => {
    const { id, jobId } = parse(jobParams, req.params);
    const q = parse(
      z.object({ wait: z.coerce.number().min(0).max(30).optional(), status: z.string().max(20).optional() }),
      req.query,
    );
    await access(req, id, 'read');
    const job =
      q.wait && q.status
        ? await s.compile.waitForChange(id, jobId, q.status, q.wait * 1000)
        : await s.compile.get(id, jobId);
    return { job: toCompileJobDTO(job) };
  });

  app.get('/api/projects/:id/compile/:jobId/output.pdf', async (req, reply) => {
    const { id, jobId } = parse(jobParams, req.params);
    const { download } = parse(z.object({ download: z.string().optional() }), req.query);
    const { project } = await access(req, id, 'read');
    const job = await s.compile.get(id, jobId);
    if (!job.pdfKey) throw badRequest('no_pdf', 'This compile did not produce a PDF');
    // Generated by our compiler, so no CSP sandbox (it would block browser PDF viewers).
    reply
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header('content-type', 'application/pdf')
      .header(
        'content-disposition',
        contentDisposition(download ? 'attachment' : 'inline', `${project.name}.pdf`),
      );
    return reply.send(await s.storage.getStream(job.pdfKey));
  });

  // --- SyncTeX: source <-> PDF -------------------------------------------------

  app.get('/api/projects/:id/compile/:jobId/synctex/code', async (req) => {
    const { id, jobId } = parse(jobParams, req.params);
    const q = parse(z.object({ file: z.string().min(1).max(255), line: z.coerce.number().int().min(1) }), req.query);
    await access(req, id, 'read');
    const result = await s.synctex.forward(await s.compile.get(id, jobId), q.file, q.line);
    if (!result) throw notFound('Position');
    return { position: result };
  });

  app.get('/api/projects/:id/compile/:jobId/synctex/pdf', async (req) => {
    const { id, jobId } = parse(jobParams, req.params);
    const q = parse(
      z.object({ page: z.coerce.number().int().min(1), x: z.coerce.number(), y: z.coerce.number() }),
      req.query,
    );
    await access(req, id, 'read');
    const result = await s.synctex.reverse(await s.compile.get(id, jobId), q.page, q.x, q.y);
    if (!result) throw notFound('Position');
    return { source: result };
  });

  app.get('/api/projects/:id/compile/:jobId/output.log', async (req, reply) => {
    const { id, jobId } = parse(jobParams, req.params);
    await access(req, id, 'read');
    const job = await s.compile.get(id, jobId);
    if (!job.logKey) throw badRequest('no_log', 'No log available for this compile');
    reply.headers(SAFE_CONTENT_HEADERS).header('content-type', 'text/plain; charset=utf-8');
    return reply.send(await s.storage.getStream(job.logKey));
  });
}
