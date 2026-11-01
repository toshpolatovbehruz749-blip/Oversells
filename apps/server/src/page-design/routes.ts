import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  PAGE_DESIGN_FILE,
  buildPreflight,
  withBlankPages,
  PageDesignError,
  defaultPageDesign,
  generatePageDesignPackage,
  normalizePageDesign,
  readPageDesign,
  withPageDesignPackage,
} from '@oversells/shared';
import { requireUser } from '../auth/http.js';
import { badRequest } from '../errors.js';
import { parse } from '../validation.js';
import { shareTokenOf } from '../routes.js';
import { toFileDTO } from '../dto.js';
import type { AccessService } from '../access/access-service.js';
import type { FileService } from '../files/file-service.js';
import type { DocManager } from '../collab/doc-manager.js';
import type { CompileService } from '../compile/compile-service.js';
import type { Storage } from '../storage/storage.js';
import { parseLatexLog } from '../compile/log-parser.js';
import { newId } from '../ids.js';

const idParams = z.object({ id: z.string().min(1).max(64) });

/**
 * «Sahifa dizayni» (behind PAGE_DESIGN_ENABLED): the project's styles and
 * master pages, kept in sahifa.sty. GET reads the model from the file (or
 * offers the default one), PUT checks it, rewrites sahifa.sty and loads the
 * package in the main file.
 */
export async function registerPageDesignRoutes(
  app: FastifyInstance,
  deps: {
    access: AccessService;
    files: FileService;
    docs: DocManager;
    prisma: PrismaClient;
    compile: CompileService;
    storage: Storage;
  },
): Promise<void> {
  const fileOf = (projectId: string) =>
    deps.prisma.projectFile.findUnique({ where: { projectId_path: { projectId, path: PAGE_DESIGN_FILE } } });

  app.get('/api/projects/:id/page-design', async (req) => {
    const { id } = parse(idParams, req.params);
    const { project } = await deps.access.require(req.user, shareTokenOf(req), id, 'read');
    const file = await fileOf(id);
    if (!file || file.kind !== 'text') return { design: defaultPageDesign(project.name), exists: false, readable: true };
    const design = readPageDesign(await deps.docs.getText(file.id));
    // A sahifa.sty without a readable model (written by hand) is never overwritten silently.
    return design
      ? { design, exists: true, readable: true }
      : { design: defaultPageDesign(project.name), exists: true, readable: false };
  });

  app.put('/api/projects/:id/page-design', async (req) => {
    const user = requireUser(req.user);
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ design: z.unknown(), replaceUnreadable: z.boolean().optional() }), req.body);
    const { project } = await deps.access.require(user, shareTokenOf(req), id, 'write');
    let design;
    try {
      design = normalizePageDesign(body.design);
    } catch (err) {
      if (err instanceof PageDesignError) throw badRequest('invalid_page_design', err.message);
      throw err;
    }
    const sty = generatePageDesignPackage(design);
    const existing = await fileOf(id);
    if (existing && existing.kind === 'text' && !body.replaceUnreadable) {
      if (!readPageDesign(await deps.docs.getText(existing.id))) {
        throw badRequest('page_design_unreadable', `${PAGE_DESIGN_FILE} was written by hand; it is not replaced`);
      }
    }
    const file = existing
      ? await deps.files.saveText(id, existing.id, sty)
      : await deps.files.createText(id, PAGE_DESIGN_FILE, sty);
    let mainChanged = false;
    const main = await deps.prisma.projectFile.findUnique({
      where: { projectId_path: { projectId: id, path: project.mainFile } },
    });
    if (main?.kind === 'text') {
      const updated = withPageDesignPackage(await deps.docs.getText(main.id));
      if (updated !== null) mainChanged = await deps.docs.setText(main.id, updated);
    }
    return { design, file: toFileDTO(file), mainChanged };
  });

  // --- Preflight: the latest PDF checked with poppler in the sandbox -------------------------

  app.post('/api/projects/:id/preflight', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ multiple: z.union([z.literal(16), z.literal(32)]).default(16) }), req.body ?? {});
    await deps.access.require(req.user, shareTokenOf(req), id, 'read');
    // A compile still running (e.g. right after a fix) is waited for: its PDF is the one to check.
    let job = await deps.compile.latest(id);
    const deadline = Date.now() + 5 * 60_000;
    while (job && (job.status === 'queued' || job.status === 'running') && Date.now() < deadline) {
      job = await deps.compile.waitForChange(id, job.id, job.status, 25_000);
    }
    if (!job?.pdfKey) throw badRequest('no_pdf', 'Compile the project first');
    const pdf = await deps.storage.get(job.pdfKey);
    const log = job.logKey ? (await deps.storage.get(job.logKey)).toString('utf8') : '';
    const result = await deps.compile.convert(`preflight-${newId()}`, [{ path: 'out.pdf', data: pdf }], 'pdf-preflight');
    if (result.status !== 'success') throw badRequest('preflight_failed', 'The PDF could not be checked');
    const text = (name: string) => result.files.find((f) => f.path === name)?.data.toString('utf8') ?? '';
    const overfull = parseLatexLog(log)
      .filter((e) => /^Overfull \\hbox/.test(e.message))
      .map((e) => ({ file: e.file, line: e.line, message: e.message }));
    const report = buildPreflight({
      info: text('info.txt'),
      fonts: text('fonts.txt'),
      images: text('images.txt'),
      pageText: text('pages.txt'),
      overfull,
      multiple: body.multiple,
    });
    return { report, jobId: job.id };
  });

  /** Fix of the page count: blank pages (\bosbet) before \end{document} of the main file. */
  app.post('/api/projects/:id/preflight/blank-pages', async (req) => {
    const user = requireUser(req.user);
    const { id } = parse(idParams, req.params);
    const { count } = parse(z.object({ count: z.number().int().min(1).max(31) }), req.body);
    const { project } = await deps.access.require(user, shareTokenOf(req), id, 'write');
    const main = await deps.prisma.projectFile.findUnique({
      where: { projectId_path: { projectId: id, path: project.mainFile } },
    });
    if (main?.kind !== 'text') throw badRequest('no_main', 'The main file is not a text file');
    const updated = withBlankPages(await deps.docs.getText(main.id), count);
    if (updated === null) throw badRequest('no_document_end', 'The main file has no \\end{document}');
    await deps.docs.setText(main.id, updated);
    return { added: count };
  });
}
