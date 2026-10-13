import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { COMPILERS } from '@oversells/shared';
import { badRequest } from './errors.js';
import { toCompileJobDTO, toFileDTO, toProjectDTO } from './dto.js';
import type { ProjectService } from './projects/project-service.js';
import type { FileService } from './files/file-service.js';
import type { CompileService } from './compile/compile-service.js';
import type { CompileRunner } from './compile/runner.js';
import type { Storage } from './storage/storage.js';
import { TEMPLATE_NAMES } from './projects/templates.js';
import { contentDisposition, zipProject } from './projects/zip.js';

export interface Services {
  projects: ProjectService;
  files: FileService;
  compile: CompileService;
  runner: CompileRunner;
  storage: Storage;
  maxTextFileBytes: number;
  maxUploadBytes: number;
}

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const res = schema.safeParse(value);
  if (!res.success) {
    const issue = res.error.issues[0];
    throw badRequest('invalid_request', issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request');
  }
  return res.data;
}

const idParams = z.object({ id: z.string().min(1).max(64) });
const fileParams = idParams.extend({ fileId: z.string().min(1).max(64) });
const jobParams = idParams.extend({ jobId: z.string().min(1).max(64) });

const createProjectBody = z.object({
  name: z.string(),
  template: z.enum(TEMPLATE_NAMES).optional(),
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
};

export async function registerRoutes(app: FastifyInstance, s: Services): Promise<void> {
  app.get('/api/health', async () => {
    const compiler = await s.runner.check();
    return { status: 'ok', compiler };
  });

  // --- projects ------------------------------------------------------------

  app.get('/api/projects', async () => {
    const projects = await s.projects.list();
    return { projects: projects.map(toProjectDTO) };
  });

  app.post('/api/projects', async (req, reply) => {
    const body = parse(createProjectBody, req.body);
    const project = await s.projects.create(body);
    reply.code(201);
    return { project: toProjectDTO(project) };
  });

  app.get('/api/projects/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const project = await s.projects.getWithFiles(id);
    return { project: { ...toProjectDTO(project), files: project.files.map(toFileDTO) } };
  });

  app.patch('/api/projects/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(updateProjectBody, req.body ?? {});
    return { project: toProjectDTO(await s.projects.update(id, body)) };
  });

  app.delete('/api/projects/:id', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    await s.projects.delete(id);
    reply.code(204);
  });

  app.get('/api/projects/:id/download.zip', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const project = await s.projects.getWithFiles(id);
    reply
      .header('content-type', 'application/zip')
      .header('content-disposition', contentDisposition('attachment', `${project.name}.zip`));
    return reply.send(zipProject(project.files, s.storage));
  });

  // --- files ---------------------------------------------------------------

  app.post('/api/projects/:id/files', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ path: z.string(), content: z.string().optional() }), req.body);
    await s.projects.require(id);
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
    await s.projects.require(id);
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
      const file = await s.files.saveText(id, fileId, body.content);
      await s.projects.touch(id);
      return { file: toFileDTO(file) };
    },
  );

  app.patch('/api/projects/:id/files/:fileId', async (req) => {
    const { id, fileId } = parse(fileParams, req.params);
    const body = parse(z.object({ path: z.string() }), req.body);
    const file = await s.files.move(id, fileId, body.path);
    await s.projects.touch(id);
    return { file: toFileDTO(file) };
  });

  app.delete('/api/projects/:id/files/:fileId', async (req, reply) => {
    const { id, fileId } = parse(fileParams, req.params);
    await s.files.delete(id, fileId);
    await s.projects.touch(id);
    reply.code(204);
  });

  app.post('/api/projects/:id/folders/rename', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ from: z.string(), to: z.string() }), req.body);
    await s.projects.require(id);
    const moved = await s.files.renameFolder(id, body.from, body.to);
    await s.projects.touch(id);
    return { moved };
  });

  app.delete('/api/projects/:id/folders', async (req) => {
    const { id } = parse(idParams, req.params);
    const { path } = parse(z.object({ path: z.string() }), req.query);
    await s.projects.require(id);
    const deleted = await s.files.deleteFolder(id, path);
    await s.projects.touch(id);
    return { deleted };
  });

  // --- compile -------------------------------------------------------------

  app.post('/api/projects/:id/compile', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ wait: z.boolean().optional() }), req.body ?? {});
    const { job, done } = await s.compile.request(id);
    if (body.wait) {
      return { job: toCompileJobDTO(await done) };
    }
    reply.code(202);
    return { job: toCompileJobDTO(job) };
  });

  app.get('/api/projects/:id/compile/latest', async (req) => {
    const { id } = parse(idParams, req.params);
    const job = await s.compile.latest(id);
    return { job: job ? toCompileJobDTO(job) : null };
  });

  app.get('/api/projects/:id/compile/:jobId', async (req) => {
    const { id, jobId } = parse(jobParams, req.params);
    return { job: toCompileJobDTO(await s.compile.get(id, jobId)) };
  });

  app.get('/api/projects/:id/compile/:jobId/output.pdf', async (req, reply) => {
    const { id, jobId } = parse(jobParams, req.params);
    const { download } = parse(z.object({ download: z.string().optional() }), req.query);
    const job = await s.compile.get(id, jobId);
    if (!job.pdfKey) throw badRequest('no_pdf', 'This compile did not produce a PDF');
    const project = await s.projects.require(id);
    // Generated by our compiler, so no CSP sandbox (it would block browser PDF viewers).
    reply
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'no-store')
      .header('content-type', 'application/pdf')
      .header(
        'content-disposition',
        contentDisposition(download ? 'attachment' : 'inline', `${project.name}.pdf`),
      );
    return reply.send(await s.storage.getStream(job.pdfKey));
  });

  app.get('/api/projects/:id/compile/:jobId/output.log', async (req, reply) => {
    const { id, jobId } = parse(jobParams, req.params);
    const job = await s.compile.get(id, jobId);
    if (!job.logKey) throw badRequest('no_log', 'No log available for this compile');
    reply.headers(SAFE_CONTENT_HEADERS).header('content-type', 'text/plain; charset=utf-8');
    return reply.send(await s.storage.getStream(job.logKey));
  });
}
