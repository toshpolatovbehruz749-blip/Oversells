import type { PrismaClient, Project } from '@prisma/client';
import { COMPILERS, fileKindOf, mimeTypeOf, type Compiler, type SpellLanguage } from '@oversells/shared';
import { badRequest, notFound } from '../errors.js';
import { keys, type Storage } from '../storage/storage.js';
import { DEFAULT_TEMPLATE, type TemplateStore } from './templates.js';
import { requireFilePath } from '../files/validation.js';
import { newId } from '../ids.js';

export const MAX_PROJECT_NAME = 200;

export interface CreateProjectInput {
  name: string;
  template?: string;
  compiler?: Compiler;
}

export interface UpdateProjectInput {
  name?: string;
  spellLanguage?: SpellLanguage;
  compiler?: Compiler;
  mainFile?: string;
}

export function normalizeProjectName(name: unknown): string {
  if (typeof name !== 'string') throw badRequest('invalid_name', 'Project name is required');
  // eslint-disable-next-line no-control-regex
  const trimmed = name.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (trimmed.length === 0) throw badRequest('invalid_name', 'Project name is required');
  if (trimmed.length > MAX_PROJECT_NAME) throw badRequest('invalid_name', 'Project name is too long');
  return trimmed;
}

export class ProjectService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: Storage,
    private readonly templates: TemplateStore,
  ) {}

  /** Projects owned by the user, most recently updated first. */
  list(ownerId: string): Promise<Project[]> {
    return this.prisma.project.findMany({ where: { ownerId }, orderBy: { updatedAt: 'desc' } });
  }

  async require(id: string): Promise<Project> {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw notFound('Project');
    return project;
  }

  async getWithFiles(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { files: { orderBy: { path: 'asc' } } },
    });
    if (!project) throw notFound('Project');
    return project;
  }

  async create(ownerId: string, input: CreateProjectInput): Promise<Project> {
    const name = normalizeProjectName(input.name);
    const template = await this.templates.find(input.template ?? DEFAULT_TEMPLATE);
    if (!template) throw badRequest('invalid_template', 'Unknown template');
    const compiler = input.compiler ?? template.compiler;
    if (!COMPILERS.includes(compiler)) throw badRequest('invalid_compiler', 'Unknown compiler');

    const project = await this.prisma.project.create({
      data: { name, compiler, mainFile: template.mainFile, ownerId, designId: template.design ?? null },
    });
    try {
      for (const file of template.files) {
        const id = newId();
        const storageKey = keys.file(project.id, id);
        await this.storage.put(storageKey, file.data);
        await this.prisma.projectFile.create({
          data: {
            id,
            projectId: project.id,
            path: file.path,
            kind: fileKindOf(file.path) ?? 'binary',
            size: file.data.length,
            mimeType: mimeTypeOf(file.path),
            storageKey,
          },
        });
      }
    } catch (err) {
      await this.delete(project.id).catch(() => undefined);
      throw err;
    }
    return project;
  }

  /**
   * A project from stored files (restoring a backup). Paths must already be
   * valid project paths; the main file falls back to the first .tex file.
   */
  async createFromFiles(
    ownerId: string,
    meta: { name: string; compiler?: string; mainFile?: string; spellLanguage?: string; designId?: string | null },
    files: Array<{ path: string; data: Buffer }>,
  ): Promise<Project> {
    const tex = files.filter((f) => f.path.endsWith('.tex')).map((f) => f.path);
    const mainFile = meta.mainFile && tex.includes(meta.mainFile) ? meta.mainFile : (tex.find((p) => p === 'main.tex') ?? tex[0] ?? 'main.tex');
    const compiler = COMPILERS.includes(meta.compiler as Compiler) ? (meta.compiler as Compiler) : 'xelatex';
    const project = await this.prisma.project.create({
      data: {
        name: normalizeProjectName(meta.name),
        compiler,
        mainFile,
        ownerId,
        ...(meta.spellLanguage ? { spellLanguage: meta.spellLanguage } : {}),
        designId: meta.designId ?? null,
      },
    });
    try {
      for (const file of files) {
        const id = newId();
        const storageKey = keys.file(project.id, id);
        await this.storage.put(storageKey, file.data);
        await this.prisma.projectFile.create({
          data: {
            id,
            projectId: project.id,
            path: file.path,
            kind: fileKindOf(file.path) ?? 'binary',
            size: file.data.length,
            mimeType: mimeTypeOf(file.path),
            storageKey,
          },
        });
      }
    } catch (err) {
      await this.delete(project.id).catch(() => undefined);
      throw err;
    }
    return project;
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    await this.require(id);
    const data: { name?: string; compiler?: Compiler; mainFile?: string; spellLanguage?: string } = {};
    if (input.spellLanguage !== undefined) data.spellLanguage = input.spellLanguage;
    if (input.name !== undefined) data.name = normalizeProjectName(input.name);
    if (input.compiler !== undefined) {
      if (!COMPILERS.includes(input.compiler)) throw badRequest('invalid_compiler', 'Unknown compiler');
      data.compiler = input.compiler;
    }
    if (input.mainFile !== undefined) {
      const mainFile = requireFilePath(input.mainFile);
      if (!mainFile.endsWith('.tex')) throw badRequest('invalid_main_file', 'Main file must be a .tex file');
      const exists = await this.prisma.projectFile.findUnique({
        where: { projectId_path: { projectId: id, path: mainFile } },
      });
      if (!exists) throw badRequest('invalid_main_file', 'Main file does not exist in the project');
      data.mainFile = mainFile;
    }
    return this.prisma.project.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.require(id);
    await this.prisma.project.delete({ where: { id } });
    await this.storage.deletePrefix(keys.project(id));
  }

  /** Bumps updatedAt so the project list reflects recent edits. */
  async touch(id: string): Promise<void> {
    await this.prisma.project.update({ where: { id }, data: { updatedAt: new Date() } });
  }
}
