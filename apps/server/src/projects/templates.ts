import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { COMPILERS, checkProjectPath, type Compiler, type Localized, type TemplateDTO } from '@oversells/shared';
import { z } from 'zod';

export const DEFAULT_TEMPLATE = 'textbook';

/** Files in a template directory that describe it but are not copied into projects. */
const META_FILES = new Set(['template.json']);

const localized = z.object({ uz: z.string(), ru: z.string(), en: z.string() });
const metaSchema = z.object({
  order: z.number().int().default(100),
  compiler: z.enum(COMPILERS),
  mainFile: z.string(),
  title: localized,
  description: localized,
});

export interface TemplateFile {
  path: string;
  data: Buffer;
}

export interface Template {
  name: string;
  compiler: Compiler;
  mainFile: string;
  order: number;
  title: Localized;
  description: Localized;
  files: TemplateFile[];
  /** SHA-256 over all files; changes when the template changes. */
  hash: string;
}

async function walk(dir: string, prefix = ''): Promise<TemplateFile[]> {
  const out: TemplateFile[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, rel)));
    else if (entry.isFile() && !(prefix === '' && META_FILES.has(entry.name))) {
      out.push({ path: rel, data: await readFile(full) });
    }
  }
  return out;
}

export function toTemplateDTO(t: Template): TemplateDTO {
  return { name: t.name, title: t.title, description: t.description, compiler: t.compiler };
}

/**
 * Loads project templates from `<templatesDir>/<name>/`. Each template has a
 * `template.json` (titles, descriptions, compiler, main file) next to its files.
 */
export class TemplateStore {
  private loaded: Promise<Map<string, Template>> | null = null;

  constructor(private readonly templatesDir: string) {}

  private load(): Promise<Map<string, Template>> {
    this.loaded ??= (async () => {
      const map = new Map<string, Template>();
      const entries = await readdir(this.templatesDir, { withFileTypes: true });
      for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
        const dir = path.join(this.templatesDir, entry.name);
        const meta = metaSchema.parse(JSON.parse(await readFile(path.join(dir, 'template.json'), 'utf8')));
        const files = (await walk(dir)).sort((a, b) => a.path.localeCompare(b.path));
        for (const f of files) {
          if (!checkProjectPath(f.path).ok) throw new Error(`Template ${entry.name} has invalid path ${f.path}`);
        }
        if (!files.some((f) => f.path === meta.mainFile)) {
          throw new Error(`Template ${entry.name} has no main file ${meta.mainFile}`);
        }
        const hash = createHash('sha256');
        for (const f of files) hash.update(f.path).update('\0').update(f.data).update('\0');
        map.set(entry.name, { name: entry.name, ...meta, files, hash: hash.digest('hex') });
      }
      return map;
    })();
    return this.loaded;
  }

  async list(): Promise<Template[]> {
    return [...(await this.load()).values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  /** Returns the template or null if there is none with that name. */
  async find(name: string): Promise<Template | null> {
    return (await this.load()).get(name) ?? null;
  }
}
