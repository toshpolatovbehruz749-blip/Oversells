import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { DESIGN_LANGUAGES } from '@oversells/shared';
import { requireUser } from '../auth/http.js';
import { AppError } from '../errors.js';
import { parse } from '../validation.js';
import { shareTokenOf } from '../routes.js';
import { toFileDTO, toProjectDTO } from '../dto.js';
import type { AccessService } from '../access/access-service.js';
import type { FileService } from '../files/file-service.js';
import type { DocManager } from '../collab/doc-manager.js';
import { designLanguageFor, type DesignService } from './design-service.js';

const idParams = z.object({ id: z.string().min(1).max(64) });
const nameSchema = z.string().trim().min(1).max(100);

export async function registerDesignRoutes(
  app: FastifyInstance,
  deps: { designs: DesignService; access: AccessService; files: FileService; docs: DocManager; prisma: PrismaClient },
): Promise<void> {
  const { designs } = deps;

  const sendPreview = async (reply: FastifyReply, kind: 'png' | 'pdf', data: Buffer, cache: string) => {
    reply
      .header('content-type', kind === 'png' ? 'image/png' : 'application/pdf')
      .header('cache-control', cache)
      .header('x-content-type-options', 'nosniff');
    return reply.send(data);
  };

  app.get('/api/designs', async (req) => ({ designs: await designs.list(req.user) }));

  app.get('/api/designs/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    return { design: await designs.get(id, req.user) };
  });

  const previewRoute = (kind: 'png' | 'pdf') => async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = parse(idParams, req.params);
    const design = await designs.get(id, req.user);
    const preview = await designs.preview(design.spec);
    if (!preview) throw new AppError(422, 'design_failed', 'The design preview could not be compiled');
    return sendPreview(reply, kind, preview[kind], design.builtIn ? 'public, max-age=3600' : 'private, no-cache');
  };
  app.get('/api/designs/:id/preview.png', previewRoute('png'));
  app.get('/api/designs/:id/showcase.pdf', previewRoute('pdf'));

  // Preview of an unsaved design (the design editor); cached by content hash.
  app.post('/api/designs/preview', async (req) => {
    requireUser(req.user);
    const { spec } = parse(z.object({ spec: z.unknown() }), req.body);
    const preview = await designs.preview(designs.parseSpec(spec));
    if (!preview) throw new AppError(422, 'design_failed', 'The design preview could not be compiled');
    return { hash: preview.hash };
  });

  app.get('/api/designs/previews/:file', async (req, reply) => {
    const { file } = parse(z.object({ file: z.string().max(40) }), req.params);
    const m = /^([0-9a-f]{24})\.(png|pdf)$/.exec(file);
    if (!m) throw new AppError(404, 'not_found', 'Preview not found');
    const data = await designs.cachedPreview(m[1]!, m[2] as 'png' | 'pdf');
    if (!data) throw new AppError(404, 'not_found', 'Preview not found');
    return sendPreview(reply, m[2] as 'png' | 'pdf', data, 'public, max-age=86400, immutable');
  });

  app.get('/api/designs/:id/dizayn.sty', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const { lang } = parse(z.object({ lang: z.enum(DESIGN_LANGUAGES).default('uz-latn') }), req.query);
    const design = await designs.get(id, req.user);
    reply
      .header('content-type', 'text/x-tex; charset=utf-8')
      .header('content-disposition', 'attachment; filename="dizayn.sty"')
      .header('x-content-type-options', 'nosniff');
    return designs.packageFor(design.spec, lang, design.name.uz);
  });

  app.post('/api/designs', async (req, reply) => {
    const user = requireUser(req.user);
    const body = parse(z.object({ name: nameSchema, spec: z.unknown() }), req.body);
    reply.code(201);
    return { design: await designs.create(user, body.name, body.spec) };
  });

  app.patch('/api/designs/:id', async (req) => {
    const user = requireUser(req.user);
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ name: nameSchema.optional(), spec: z.unknown().optional() }).strict(), req.body ?? {});
    return { design: await designs.update(user, id, body) };
  });

  app.delete('/api/designs/:id', async (req, reply) => {
    const user = requireUser(req.user);
    const { id } = parse(idParams, req.params);
    await designs.delete(user, id);
    reply.code(204);
  });

  // Apply a design to a project: writes dizayn.sty and loads it from the main file.
  app.post('/api/projects/:id/design', async (req) => {
    const user = requireUser(req.user);
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({ designId: z.string().min(1).max(64), lang: z.enum(DESIGN_LANGUAGES).optional() }),
      req.body,
    );
    const { project } = await deps.access.require(user, shareTokenOf(req), id, 'write');
    const lang = body.lang ?? designLanguageFor(project.spellLanguage);
    const result = await designs.apply(id, body.designId, lang, user, deps.files, deps.docs);
    const updated = await deps.prisma.project.findUniqueOrThrow({ where: { id } });
    return { file: toFileDTO(result.file), mainChanged: result.mainChanged, project: toProjectDTO(updated) };
  });
}
