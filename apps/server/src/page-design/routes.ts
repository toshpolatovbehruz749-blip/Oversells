import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  PAGE_DESIGN_FILE,
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

const idParams = z.object({ id: z.string().min(1).max(64) });

/**
 * «Sahifa dizayni» (behind PAGE_DESIGN_ENABLED): the project's styles and
 * master pages, kept in sahifa.sty. GET reads the model from the file (or
 * offers the default one), PUT checks it, rewrites sahifa.sty and loads the
 * package in the main file.
 */
export async function registerPageDesignRoutes(
  app: FastifyInstance,
  deps: { access: AccessService; files: FileService; docs: DocManager; prisma: PrismaClient },
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
}
