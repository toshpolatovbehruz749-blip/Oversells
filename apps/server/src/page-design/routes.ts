import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  COVER_FILE,
  CoverError,
  coverGeometry,
  coverSpineCheck,
  defaultCover,
  generateCover,
  normalizeCover,
  pagesFromLog,
  readCover,
  PAGE_DESIGN_FILE,
  mergeStyleInDesign,
  mergeStyleInText,
  buildPreflight,
  parsePageLayout,
  setFrameKeys,
  withBlankPages,
  PageDesignError,
  defaultPageDesign,
  generatePageDesignPackage,
  normalizePageDesign,
  readPageDesign,
  withPageDesignPackage,
} from '@oversells/shared';
import { requireUser } from '../auth/http.js';
import { AppError, badRequest } from '../errors.js';
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
import { contentDisposition } from '../projects/zip.js';
import { zipSync } from 'fflate';
import { buildIdmlExport } from './idml-export.js';
import { buildCorelExport } from './corel-export.js';

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
  /** What a save is based on: a hash of sahifa.sty as it was read ('' when there is none). */
  const versionOf = (text: string | null) => (text === null ? '' : createHash('sha1').update(text).digest('hex').slice(0, 16));

  app.get('/api/projects/:id/page-design', async (req) => {
    const { id } = parse(idParams, req.params);
    const { project } = await deps.access.require(req.user, shareTokenOf(req), id, 'read');
    const file = await fileOf(id);
    if (!file || file.kind !== 'text') return { design: defaultPageDesign(project.name), exists: false, readable: true, version: versionOf(null) };
    const text = await deps.docs.getText(file.id);
    const design = readPageDesign(text);
    const version = versionOf(text);
    // A sahifa.sty without a readable model (written by hand) is never overwritten silently.
    return design
      ? { design, exists: true, readable: true, version }
      : { design: defaultPageDesign(project.name), exists: true, readable: false, version };
  });

  app.put('/api/projects/:id/page-design', async (req) => {
    const user = requireUser(req.user);
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({ design: z.unknown(), replaceUnreadable: z.boolean().optional(), version: z.string().max(64).optional() }),
      req.body,
    );
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
    const current = existing?.kind === 'text' ? await deps.docs.getText(existing.id) : null;
    // Saved over a sahifa.sty that changed since it was read (a margin dragged in visual mode,
    // a colleague's save): refused, so the newer design is not lost without a word.
    if (body.version !== undefined && body.version !== versionOf(current)) {
      throw new AppError(409, 'page_design_changed', `${PAGE_DESIGN_FILE} changed since it was read`);
    }
    if (current !== null && !body.replaceUnreadable) {
      if (!readPageDesign(current)) {
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
    return { design, file: toFileDTO(file), mainChanged, version: versionOf(sty) };
  });

  /**
   * Merges style `from` into `to` (Word styles after an import onto the book's own): every use in
   * the project's .tex files is changed, then the style is removed from sahifa.sty.
   */
  app.post('/api/projects/:id/page-design/merge', async (req) => {
    const user = requireUser(req.user);
    const { id } = parse(idParams, req.params);
    const styleId = z.string().regex(/^[a-z][a-z0-9]{0,29}$/);
    const body = parse(z.object({ kind: z.enum(['paragraph', 'character']), from: styleId, to: styleId }), req.body);
    await deps.access.require(user, shareTokenOf(req), id, 'write');
    const file = await fileOf(id);
    const design = file?.kind === 'text' ? readPageDesign(await deps.docs.getText(file.id)) : null;
    if (!file || !design) throw badRequest('no_page_design', `No readable ${PAGE_DESIGN_FILE} in the project`);
    let merged;
    try {
      merged = mergeStyleInDesign(design, body.kind, body.from, body.to);
    } catch (err) {
      if (err instanceof PageDesignError) throw badRequest('invalid_page_design', err.message);
      throw err;
    }
    const texFiles = await deps.prisma.projectFile.findMany({ where: { projectId: id, kind: 'text' } });
    let uses = 0;
    let files = 0;
    for (const f of texFiles.filter((x) => /\.(tex|ltx)$/i.test(x.path))) {
      const r = mergeStyleInText(await deps.docs.getText(f.id), body.kind, body.from, body.to);
      if (r.count) {
        await deps.docs.setText(f.id, r.text);
        uses += r.count;
        files++;
      }
    }
    const sty = generatePageDesignPackage(merged);
    await deps.files.saveText(id, file.id, sty);
    return { design: merged, uses, files, version: versionOf(sty) };
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
      bleedPictures: /^OVS-BLEED/m.test(log),
      paper: parsePageLayout(log)?.paper,
    });
    // The cover's spine against the book's page count (only when there is a readable muqova.tex).
    const cover = await coverFile(id);
    const coverSpec = cover?.kind === 'text' ? readCover(await deps.docs.getText(cover.id)) : null;
    if (coverSpec && report.pages > 0) report.checks.push(coverSpineCheck(coverSpec, report.pages));
    return { report, jobId: job.id };
  });

  /** Fix of the cover: muqova.tex made again for the book's page count (the spine follows). */
  app.post('/api/projects/:id/preflight/cover-pages', async (req) => {
    const user = requireUser(req.user);
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ pages: z.number().int().min(4).max(5000) }), req.body);
    await deps.access.require(user, shareTokenOf(req), id, 'write');
    const file = await coverFile(id);
    const cover = file?.kind === 'text' ? readCover(await deps.docs.getText(file.id)) : null;
    if (!file || !cover) throw badRequest('no_cover', 'No readable cover in the project');
    const updated = normalizeCover({ ...cover, pages: body.pages });
    await deps.files.saveText(id, file.id, generateCover(updated));
    return { cover: updated, geometry: coverGeometry(updated) };
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

  // --- Visual editor ---------------------------------------------------------------------------

  /** The page layout and the fixed frames of the latest compile (from what sahifa.sty wrote into the log). */
  app.get('/api/projects/:id/page-layout', async (req) => {
    const { id } = parse(idParams, req.params);
    const { project } = await deps.access.require(req.user, shareTokenOf(req), id, 'read');
    const job = await deps.compile.latest(id);
    if (!job?.logKey) return { layout: null, jobId: job?.id ?? null };
    const layout = parsePageLayout((await deps.storage.get(job.logKey)).toString('utf8'));
    // A chapter preview compiles main-bob.tex with the main file's lines.
    const preview = project.mainFile.replace(/\.tex$/, '-bob.tex');
    for (const f of layout?.frames ?? []) {
      f.file = f.file.replace(/^\.\//, '');
      if (f.file === preview) f.file = project.mainFile;
    }
    return { layout, jobId: job.id };
  });

  /** Moves or resizes a fixed frame: sets x, y, en (mm) of the \rasmramka at file:line. */
  app.post('/api/projects/:id/page-design/frame', async (req) => {
    const user = requireUser(req.user);
    const { id } = parse(idParams, req.params);
    const mm = z.number().min(-50).max(1000).optional();
    const body = parse(z.object({ file: z.string().min(1).max(255), line: z.number().int().min(1), x: mm, y: mm, w: mm }), req.body);
    await deps.access.require(user, shareTokenOf(req), id, 'write');
    const file = await deps.prisma.projectFile.findUnique({ where: { projectId_path: { projectId: id, path: body.file } } });
    if (file?.kind !== 'text') throw badRequest('frame_not_found', 'No such file');
    const round = (v: number) => `${Math.round(v * 10) / 10}mm`;
    const changes: Record<string, string> = {};
    if (body.x !== undefined) changes.x = round(body.x);
    if (body.y !== undefined) changes.y = round(body.y);
    if (body.w !== undefined) changes.en = round(Math.max(5, body.w));
    const updated = setFrameKeys(await deps.docs.getText(file.id), body.line, changes, { fixedOnly: true });
    if (updated === null) throw badRequest('frame_not_found', 'No picture frame at that line');
    await deps.docs.setText(file.id, updated);
    return { changes };
  });

  // --- «InDesignʼda ochish» (desktop app on a Mac) -------------------------------------------------
  // The helper app on the Mac («Oversells Yordamchi») gets an oversells-open:// link with a
  // ticket, downloads the package with it (no cookie: it is not the browser) and opens it in
  // InDesign. A ticket is random, for one project, used once and good for two minutes.
  const tickets = new Map<string, { projectId: string; kind: 'indesign' | 'coreldraw'; expires: number }>();
  const TICKET_MS = 2 * 60_000;
  app.post('/api/projects/:id/idml/ticket', async (req) => {
    const { id } = parse(idParams, req.params);
    const { kind } = parse(z.object({ kind: z.enum(['indesign', 'coreldraw']).default('indesign') }), req.body ?? {});
    await deps.access.require(req.user, shareTokenOf(req), id, 'read');
    const now = Date.now();
    for (const [k, v] of tickets) if (v.expires < now) tickets.delete(k);
    const ticket = randomBytes(24).toString('base64url');
    tickets.set(ticket, { projectId: id, kind, expires: now + TICKET_MS });
    return { ticket, url: `oversells-open://open?ticket=${ticket}` };
  });
  app.get('/api/idml-ticket/:ticket', async (req, reply) => {
    const { ticket } = parse(z.object({ ticket: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) }), req.params);
    const t = tickets.get(ticket);
    tickets.delete(ticket);
    if (!t || t.expires < Date.now()) throw new AppError(404, 'not_found', 'No such ticket (they last two minutes and work once)');
    if (t.kind === 'coreldraw') {
      const corel = await buildCorelExport(deps, t.projectId);
      reply
        .header('content-type', 'application/zip')
        .header('cache-control', 'no-store')
        .header('x-content-type-options', 'nosniff')
        .header('content-disposition', contentDisposition('attachment', corel.fileName));
      return reply.send(Buffer.from(corel.data));
    }
    const out = await buildIdmlExport(deps, t.projectId);
    // Always the package (.idml with Links/ and Document fonts/), so the helper does one thing.
    const pkg: Record<string, [Uint8Array, { level: 0 | 6 }]> = { [out.idmlName]: [out.idml, { level: 0 }] };
    for (const [p, data] of Object.entries(out.extras)) pkg[p] = [data, { level: 0 }];
    reply
      .header('content-type', 'application/zip')
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', contentDisposition('attachment', `${out.idmlName.replace(/\.idml$/, '')} (InDesign).zip`));
    return reply.send(Buffer.from(zipSync(pkg)));
  });

  // --- CorelDRAW: the book and cover PDFs (CorelDRAW opens them as editable documents) ------------

  app.get('/api/projects/:id/coreldraw', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    await deps.access.require(req.user, shareTokenOf(req), id, 'read');
    const out = await buildCorelExport(deps, id);
    reply
      .header('content-type', 'application/zip')
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff')
      .header('x-oversells-cover-failed', out.coverFailed ? '1' : '0')
      .header('content-disposition', contentDisposition('attachment', out.fileName));
    return reply.send(Buffer.from(out.data));
  });

  // --- InDesign (IDML) export ------------------------------------------------------------------

  /**
   * The project as an .idml for InDesign (a ZIP with Links/ and Document fonts/ when it has
   * pictures or uploaded fonts). What could not go over is listed in X-Oversells-Warnings (JSON).
   */
  app.get('/api/projects/:id/idml', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    await deps.access.require(req.user, shareTokenOf(req), id, 'read');
    const out = await buildIdmlExport(deps, id);
    reply
      .header('content-type', out.contentType)
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff')
      .header('x-oversells-warnings', encodeURIComponent(JSON.stringify(out.warnings)))
      .header('content-disposition', contentDisposition('attachment', out.fileName));
    return reply.send(Buffer.from(out.data));
  });

  // --- «Muqova»: the cover spread in muqova.tex, compiled into its own PDF --------------------

  const coverFile = (projectId: string) =>
    deps.prisma.projectFile.findUnique({ where: { projectId_path: { projectId, path: COVER_FILE } } });
  /** Pages of the latest successful PDF (from its log), for the spine. */
  const lastPages = async (projectId: string): Promise<number | null> => {
    const job = await deps.compile.latest(projectId);
    if (job?.status !== 'success' || !job.logKey) return null;
    return pagesFromLog((await deps.storage.get(job.logKey)).toString('utf8'));
  };

  app.get('/api/projects/:id/cover', async (req) => {
    const { id } = parse(idParams, req.params);
    const { project } = await deps.access.require(req.user, shareTokenOf(req), id, 'read');
    const pages = await lastPages(id);
    const file = await coverFile(id);
    const stored = file?.kind === 'text' ? readCover(await deps.docs.getText(file.id)) : null;
    const cover = stored ?? { ...defaultCover(project.name), ...(pages ? { pages } : {}) };
    return { cover, exists: !!file, readable: !file || !!stored, pages, geometry: coverGeometry(cover) };
  });

  app.put('/api/projects/:id/cover', async (req) => {
    const user = requireUser(req.user);
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ cover: z.unknown(), replaceUnreadable: z.boolean().optional() }), req.body);
    await deps.access.require(user, shareTokenOf(req), id, 'write');
    let cover;
    try {
      cover = normalizeCover(body.cover);
    } catch (err) {
      if (err instanceof CoverError) throw badRequest('invalid_cover', err.message);
      throw err;
    }
    const existing = await coverFile(id);
    if (existing?.kind === 'text' && !body.replaceUnreadable && !readCover(await deps.docs.getText(existing.id))) {
      throw badRequest('cover_unreadable', `${COVER_FILE} was written by hand; it is not replaced`);
    }
    const tex = generateCover(cover);
    const file = existing ? await deps.files.saveText(id, existing.id, tex) : await deps.files.createText(id, COVER_FILE, tex);
    return { cover, geometry: coverGeometry(cover), file: toFileDTO(file) };
  });

  /** Compiles muqova.tex (as it is, also when edited by hand) with the project's files; returns the PDF. */
  app.post('/api/projects/:id/cover/pdf', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const { project } = await deps.access.require(req.user, shareTokenOf(req), id, 'read');
    if (!(await coverFile(id))) throw badRequest('no_cover', 'Save the cover first');
    await deps.docs.flushProject(id);
    const rows = await deps.prisma.projectFile.findMany({ where: { projectId: id } });
    const files = await Promise.all(rows.map(async (f) => ({ path: f.path, data: await deps.storage.get(f.storageKey) })));
    // fontspec: pdfLaTeX projects get the cover from XeLaTeX.
    const compiler = project.compiler === 'lualatex' ? 'lualatex' : 'xelatex';
    const result = await deps.compile.render(`cover-${newId()}`, files, compiler, COVER_FILE);
    if (result.status !== 'success' || !result.pdf) {
      const errors = parseLatexLog(result.log).filter((e) => e.level === 'error').slice(0, 5);
      throw new AppError(422, 'cover_failed', errors.map((e) => e.message).join('; ') || 'The cover could not be compiled');
    }
    reply
      .header('content-type', 'application/pdf')
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', 'attachment; filename="muqova.pdf"');
    return reply.send(result.pdf);
  });
}

/**
 * The InDesign the desktop app's launcher found on this Mac («Adobe InDesign 2026»), from the
 * file it writes into the state folder each time it starts; null anywhere else.
 */
export async function desktopInDesign(stateDir: string | undefined): Promise<string | null> {
  if (!stateDir) return null;
  const name = (await readFile(path.join(stateDir, 'indesign'), 'utf8').catch(() => '')).trim();
  return /^Adobe InDesign[\w .()-]{0,60}$/.test(name) ? name : null;
}

/** The CorelDRAW the desktop app's launcher found on this Mac («CorelDRAW 2025»); null elsewhere. */
export async function desktopCorelDraw(stateDir: string | undefined): Promise<string | null> {
  if (!stateDir) return null;
  const name = (await readFile(path.join(stateDir, 'coreldraw'), 'utf8').catch(() => '')).trim();
  return /^CorelDRAW[\w .()-]{0,60}$/.test(name) ? name : null;
}
