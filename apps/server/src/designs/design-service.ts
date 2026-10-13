import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { PrismaClient, ProjectFile, User } from '@prisma/client';
import type { DesignDTO, DesignLanguage, DesignSpec, Localized } from '@oversells/shared';
import { badRequest, notFound } from '../errors.js';
import type { CompileService } from '../compile/compile-service.js';
import type { Storage } from '../storage/storage.js';
import { designSpecSchema, generateDesignPackage } from './generate.js';

export const DESIGN_FILE = 'dizayn.sty';
const MAX_DESIGNS_PER_USER = 50;

interface BuiltInDesign {
  id: string;
  order: number;
  name: Localized;
  description: Localized;
  spec: DesignSpec;
}

/** Design language from a project's spell-check language (the language its text is written in). */
export function designLanguageFor(spellLanguage: string): DesignLanguage {
  if (spellLanguage === 'uz-cyrl' || spellLanguage === 'ru' || spellLanguage === 'en') return spellLanguage;
  return 'uz-latn';
}

/** Does the preamble load the design package? */
export function loadsDesign(text: string): boolean {
  return /^[^%\n]*\\usepackage\s*(?:\[[^\]]*\])?\s*\{dizayn\}/m.test(text);
}

/** Adds \usepackage{dizayn} right before \begin{document}; null when not possible or not needed. */
export function withDesignPackage(text: string): string | null {
  if (loadsDesign(text)) return null;
  const m = /^[ \t]*\\begin\{document\}/m.exec(text);
  if (!m) return null;
  return `${text.slice(0, m.index)}\\usepackage{dizayn} % Oversells dizayni (dizayn.sty)\n${text.slice(m.index)}`;
}

export function resolveDesignsDir(here: string, configured?: string): string {
  const candidates = [configured, path.resolve(here, '../designs'), path.resolve(here, '../../designs')];
  for (const c of candidates) if (c && existsSync(path.join(c, 'showcase', 'main.tex'))) return c;
  throw new Error('Designs directory not found; set DESIGNS_DIR');
}

/** Reads the built-in designs of a designs directory. */
export function loadBuiltInDesigns(dir: string): BuiltInDesign[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const raw = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Omit<BuiltInDesign, 'id'>;
      return { ...raw, id: f.replace(/\.json$/, ''), spec: designSpecSchema.parse(raw.spec) as DesignSpec };
    })
    .sort((a, b) => a.order - b.order);
}

/** dizayn.sty of a built-in design for templates (titles in Uzbek Latin). */
export function builtInDesignPackages(dir: string): (id: string) => string | null {
  const designs = loadBuiltInDesigns(dir);
  return (id) => {
    const d = designs.find((x) => x.id === id);
    return d ? generateDesignPackage(d.spec, 'uz-latn', d.name.uz) : null;
  };
}

interface FileOps {
  createText(projectId: string, rawPath: unknown, content?: string): Promise<ProjectFile>;
  saveText(projectId: string, fileId: string, content: unknown): Promise<ProjectFile>;
}

interface TextDocs {
  getText(fileId: string): Promise<string>;
  setText(fileId: string, text: string): Promise<boolean>;
}

interface Log {
  warn(obj: unknown, msg?: string): void;
}

/**
 * Designs: the built-in ones (JSON files in the designs directory) and the
 * ones users make. A design is turned into dizayn.sty (see generate.ts);
 * previews compile the showcase document with it and are cached in storage by
 * the content hash.
 */
export class DesignService {
  private readonly builtIns: BuiltInDesign[];
  private readonly showcase: string;
  private readonly inflight = new Map<string, Promise<{ png: Buffer; pdf: Buffer } | null>>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly compile: Pick<CompileService, 'render'>,
    private readonly storage: Storage,
    dir: string,
    private readonly log: Log,
  ) {
    this.showcase = readFileSync(path.join(dir, 'showcase', 'main.tex'), 'utf8');
    this.builtIns = loadBuiltInDesigns(dir);
  }

  builtIn(id: string): BuiltInDesign | undefined {
    return this.builtIns.find((d) => d.id === id);
  }

  /** The package text of a design. */
  packageFor(spec: DesignSpec, lang: DesignLanguage, name: string): string {
    return generateDesignPackage(spec, lang, name);
  }

  /** Hash of everything a preview depends on. */
  previewHash(spec: DesignSpec, lang: DesignLanguage = 'uz-latn'): string {
    return createHash('sha256')
      .update(generateDesignPackage(spec, lang, ''))
      .update(this.showcase)
      .digest('hex')
      .slice(0, 24);
  }

  private toDTO(d: { id: string; name: Localized; description: Localized; spec: DesignSpec }, builtIn: boolean): DesignDTO {
    return { id: d.id, name: d.name, description: d.description, spec: d.spec, builtIn, hash: this.previewHash(d.spec) };
  }

  private userToDTO(d: { id: string; name: string; spec: unknown }): DesignDTO {
    const spec = designSpecSchema.parse(d.spec) as DesignSpec;
    const name = { uz: d.name, ru: d.name, en: d.name };
    return this.toDTO({ id: d.id, name, description: { uz: '', ru: '', en: '' }, spec }, false);
  }

  async list(user: User | null): Promise<DesignDTO[]> {
    const mine = user
      ? await this.prisma.design.findMany({ where: { ownerId: user.id }, orderBy: { updatedAt: 'desc' } })
      : [];
    return [...this.builtIns.map((d) => this.toDTO(d, true)), ...mine.map((d) => this.userToDTO(d))];
  }

  /** A built-in design, or the caller's own design; 404 otherwise. */
  async get(id: string, user: User | null): Promise<DesignDTO> {
    const b = this.builtIn(id);
    if (b) return this.toDTO(b, true);
    if (!user) throw notFound('Design');
    const d = await this.prisma.design.findFirst({ where: { id, ownerId: user.id } });
    if (!d) throw notFound('Design');
    return this.userToDTO(d);
  }

  async create(user: User, name: string, spec: unknown): Promise<DesignDTO> {
    const parsed = this.parseSpec(spec);
    if ((await this.prisma.design.count({ where: { ownerId: user.id } })) >= MAX_DESIGNS_PER_USER) {
      throw badRequest('too_many_designs', 'You have too many designs');
    }
    const d = await this.prisma.design.create({ data: { ownerId: user.id, name: name.trim(), spec: parsed as object } });
    return this.userToDTO(d);
  }

  async update(user: User, id: string, patch: { name?: string; spec?: unknown }): Promise<DesignDTO> {
    const existing = await this.prisma.design.findFirst({ where: { id, ownerId: user.id } });
    if (!existing) throw notFound('Design');
    const d = await this.prisma.design.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.spec !== undefined ? { spec: this.parseSpec(patch.spec) as object } : {}),
      },
    });
    return this.userToDTO(d);
  }

  async delete(user: User, id: string): Promise<void> {
    const res = await this.prisma.design.deleteMany({ where: { id, ownerId: user.id } });
    if (res.count === 0) throw notFound('Design');
  }

  parseSpec(spec: unknown): DesignSpec {
    const res = designSpecSchema.safeParse(spec);
    if (!res.success) {
      const issue = res.error.issues[0];
      throw badRequest('invalid_design', issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid design');
    }
    return res.data as DesignSpec;
  }

  // --- previews -----------------------------------------------------------------

  private previewKeys(hash: string) {
    return { png: `designs/previews/${hash}.png`, pdf: `designs/previews/${hash}.pdf` };
  }

  /** PNG of page 1 and the PDF of the showcase in this design (cached; null if it did not compile). */
  async preview(spec: DesignSpec): Promise<{ hash: string; png: Buffer; pdf: Buffer } | null> {
    const hash = this.previewHash(spec);
    const keys = this.previewKeys(hash);
    if (await this.storage.exists(keys.png)) {
      return { hash, png: await this.storage.get(keys.png), pdf: await this.storage.get(keys.pdf) };
    }
    let pending = this.inflight.get(hash);
    if (!pending) {
      pending = this.compile
        .render(`design-${hash}`, [
          { path: 'main.tex', data: Buffer.from(this.showcase, 'utf8') },
          { path: DESIGN_FILE, data: Buffer.from(generateDesignPackage(spec, 'uz-latn', ''), 'utf8') },
        ], 'xelatex')
        .then(async (r) => {
          if (!r.png || !r.pdf) {
            this.log.warn({ hash, status: r.status, log: r.log.slice(-2000) }, 'Design preview failed');
            return null;
          }
          await this.storage.put(keys.pdf, r.pdf);
          await this.storage.put(keys.png, r.png);
          return { png: r.png, pdf: r.pdf };
        })
        .finally(() => this.inflight.delete(hash));
      this.inflight.set(hash, pending);
    }
    const done = await pending;
    return done ? { hash, ...done } : null;
  }

  /** A cached preview by hash (hashes are content hashes, so they reveal nothing). */
  async cachedPreview(hash: string, kind: 'png' | 'pdf'): Promise<Buffer | null> {
    if (!/^[0-9a-f]{24}$/.test(hash)) return null;
    const key = this.previewKeys(hash)[kind];
    return (await this.storage.exists(key)) ? this.storage.get(key) : null;
  }

  /** Renders the previews of the built-in designs one after another (start-up warm-up). */
  async warmUp(): Promise<void> {
    for (const d of this.builtIns) await this.preview(d.spec).catch(() => null);
  }

  // --- applying to a project ------------------------------------------------------------

  /**
   * Writes dizayn.sty into the project (as a live edit if it exists) and
   * makes the main file load it. Returns whether the main file was changed.
   */
  async apply(
    projectId: string,
    designId: string,
    lang: DesignLanguage,
    user: User,
    files: FileOps,
    docs: TextDocs,
  ): Promise<{ file: ProjectFile; mainChanged: boolean }> {
    const design = await this.get(designId, user);
    const sty = generateDesignPackage(design.spec, lang, design.name.uz);
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound('Project');
    const existing = await this.prisma.projectFile.findUnique({
      where: { projectId_path: { projectId, path: DESIGN_FILE } },
    });
    const file = existing ? await files.saveText(projectId, existing.id, sty) : await files.createText(projectId, DESIGN_FILE, sty);

    let mainChanged = false;
    const main = await this.prisma.projectFile.findUnique({
      where: { projectId_path: { projectId, path: project.mainFile } },
    });
    if (main?.kind === 'text') {
      const updated = withDesignPackage(await docs.getText(main.id));
      if (updated !== null) mainChanged = await docs.setText(main.id, updated);
    }
    await this.prisma.project.update({ where: { id: projectId }, data: { designId } });
    return { file, mainChanged };
  }
}
