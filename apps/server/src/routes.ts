import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { COMPILERS, SHARE_ROLES } from '@oversells/shared';
import { badRequest, notFound } from './errors.js';
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
import { contentDisposition, zipProject } from './projects/zip.js';

export interface Services {
  projects: ProjectService;
  files: FileService;
  compile: CompileService;
  runner: CompileRunner;
  storage: Storage;
  access: AccessService;
  shares: ShareService;
  templates: TemplateStore;
  previews: TemplatePreviewService;
  docs: DocManager;
  versions: VersionService;
  comments: CommentService;
  synctex: SyncTexService;
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

  app.get('/api/health', async () => {
    const compiler = await s.runner.check();
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

  /** Projects other people shared with the user through links they opened. */
  app.get('/api/projects/shared', async (req) => {
    const user = requireUser(req.user);
    return { projects: await s.shares.sharedWith(user) };
  });

  app.post('/api/projects', async (req, reply) => {
    const user = requireUser(req.user);
    const body = parse(createProjectBody, req.body);
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
    s.docs.dropProject(id);
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
    s.docs.closeConnections((conn) => conn.shareToken === token, 4403, 'share link revoked');
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

  app.get('/api/projects/:id/compile/:jobId', async (req) => {
    const { id, jobId } = parse(jobParams, req.params);
    await access(req, id, 'read');
    return { job: toCompileJobDTO(await s.compile.get(id, jobId)) };
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
