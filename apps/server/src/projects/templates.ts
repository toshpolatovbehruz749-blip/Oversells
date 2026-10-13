import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkProjectPath, type Compiler } from '@oversells/shared';

export const TEMPLATE_NAMES = ['uzbek-textbook', 'blank'] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];

export interface TemplateFile {
  path: string;
  data: Buffer;
}

export interface Template {
  name: TemplateName;
  compiler: Compiler;
  mainFile: string;
  files: TemplateFile[];
}

const META: Record<TemplateName, { compiler: Compiler; mainFile: string }> = {
  'uzbek-textbook': { compiler: 'xelatex', mainFile: 'main.tex' },
  blank: { compiler: 'xelatex', mainFile: 'main.tex' },
};

async function walk(dir: string, prefix = ''): Promise<TemplateFile[]> {
  const out: TemplateFile[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, rel)));
    else if (entry.isFile()) out.push({ path: rel, data: await readFile(full) });
  }
  return out;
}

/** Loads project templates from `<templatesDir>/<name>/`. */
export class TemplateStore {
  private cache = new Map<TemplateName, Template>();

  constructor(private readonly templatesDir: string) {}

  async get(name: TemplateName): Promise<Template> {
    const cached = this.cache.get(name);
    if (cached) return cached;
    const files = await walk(path.join(this.templatesDir, name));
    for (const f of files) {
      if (!checkProjectPath(f.path).ok) throw new Error(`Template ${name} has invalid path ${f.path}`);
    }
    const template: Template = { name, ...META[name], files };
    this.cache.set(name, template);
    return template;
  }
}
