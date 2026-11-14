import type { PrismaClient } from '@prisma/client';
import { strToU8, zipSync, type Zippable } from 'fflate';
import {
  PAGE_DESIGN_FILE,
  imageInfo,
  pageSetupFromLatex,
  pagesFromLog,
  projectToIdml,
  readPageDesign,
  type IdmlExportWarning,
  type IdmlPicture,
} from '@oversells/shared';
import type { DocManager } from '../collab/doc-manager.js';
import type { CompileService } from '../compile/compile-service.js';
import type { Storage } from '../storage/storage.js';
import { AppError } from '../errors.js';

export interface IdmlExport {
  /** `${name}.idml`, or `${name} (InDesign).zip` with the .idml, its Links/ and Document fonts/. */
  fileName: string;
  contentType: string;
  data: Uint8Array;
  /** The .idml alone (for opening it next to its pictures on this computer). */
  idml: Uint8Array;
  /** Pictures and fonts that go next to the .idml: path in the package → content. */
  extras: Record<string, Uint8Array>;
  idmlName: string;
  pages: number;
  warnings: IdmlExportWarning[];
}

const PICTURE_EXT = ['', '.png', '.jpg', '.jpeg', '.pdf', '.PNG', '.JPG', '.JPEG'];

/**
 * The project as InDesign IDML: main.tex with its \input files and the sahifa.sty model.
 * Pictures it uses are linked as Links/<name> next to the .idml (InDesign finds them there),
 * uploaded fonts go into «Document fonts», which InDesign activates for the document.
 */
export async function buildIdmlExport(
  deps: { prisma: PrismaClient; docs: DocManager; storage: Storage; compile: CompileService },
  projectId: string,
): Promise<IdmlExport> {
  await deps.docs.flushProject(projectId);
  const project = await deps.prisma.project.findUnique({ where: { id: projectId }, include: { files: true } });
  if (!project) throw new AppError(404, 'not_found', 'Project not found');
  const files = new Map(project.files.map((f) => [f.path, f]));
  const main = files.get(project.mainFile);
  if (!main || main.kind !== 'text') throw new AppError(422, 'no_main_file', 'The project has no main .tex file');
  const texts = new Map<string, string>();
  for (const f of project.files) if (f.kind === 'text' && /\.(tex|sty|ltx)$/i.test(f.path)) texts.set(f.path, await deps.docs.getText(f.id));
  const mainTex = texts.get(main.path)!;
  const dir = main.path.includes('/') ? main.path.slice(0, main.path.lastIndexOf('/') + 1) : '';
  const design = texts.has(PAGE_DESIGN_FILE) ? readPageDesign(texts.get(PAGE_DESIGN_FILE)!) : null;
  // bosma.sty (print format) sets the page size through \PassOptionsToPackage{…}{geometry}.
  const setup = pageSetupFromLatex(`${texts.get('bosma.sty') ?? ''}\n${mainTex}`);

  let pages: number | null = null;
  const job = await deps.compile.latest(projectId);
  if (job?.status === 'success' && job.logKey) pages = pagesFromLog((await deps.storage.get(job.logKey)).toString('utf8'));

  // Pictures: the file as written, or with an image extension; relative to the main file or the project.
  const links = new Map<string, { name: string; data: Uint8Array }>();
  const taken = new Set<string>();
  const pictureCache = new Map<string, IdmlPicture | null>();
  const pictures = new Map<string, Uint8Array>();
  for (const f of project.files) if (f.kind === 'binary' && /\.(png|jpe?g|pdf)$/i.test(f.path)) pictures.set(f.path, new Uint8Array());
  const findPicture = (written: string): string | null => {
    const clean = written.replace(/^\.\//, '');
    for (const base of [dir + clean, clean]) for (const ext of PICTURE_EXT) if (pictures.has(base + ext)) return base + ext;
    return null;
  };
  const wanted = new Set<string>();
  // First pass: which pictures are used (the export calls picture() while it writes the story).
  projectToIdml({ title: project.name, mainTex, readFile: read, design, page: setup, pages, picture: (p) => (wanted.add(p), null) });
  for (const written of wanted) {
    const path = findPicture(written);
    if (!path) {
      pictureCache.set(written, null);
      continue;
    }
    const data = new Uint8Array(await deps.storage.get(files.get(path)!.storageKey));
    const info = imageInfo(data);
    if (!info) {
      pictureCache.set(written, null);
      continue;
    }
    let name = path.slice(path.lastIndexOf('/') + 1);
    if (taken.has(name)) name = path.replace(/\//g, '_');
    taken.add(name);
    links.set(path, { name, data });
    pictureCache.set(written, { ...info, uri: `file:Links/${encodeURI(name)}` });
  }
  const result = projectToIdml({
    title: project.name,
    mainTex,
    readFile: read,
    design,
    page: setup,
    pages,
    picture: (p) => pictureCache.get(p) ?? null,
  });

  const idml = zipParts(result.parts);
  const extras: Record<string, Uint8Array> = {};
  for (const { name, data } of links.values()) extras[`Links/${name}`] = data;
  for (const f of project.files) {
    if (f.kind === 'binary' && /\.(otf|ttf)$/i.test(f.path)) extras[`Document fonts/${f.path.slice(f.path.lastIndexOf('/') + 1)}`] = new Uint8Array(await deps.storage.get(f.storageKey));
  }
  const safe = project.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim() || 'Kitob';
  const idmlName = `${safe}.idml`;
  if (!Object.keys(extras).length) {
    return { fileName: idmlName, contentType: 'application/vnd.adobe.indesign-idml-package', data: idml, idml, extras, idmlName, pages: result.pages, warnings: result.warnings };
  }
  const pkg: Zippable = { [idmlName]: [idml, { level: 0 }] };
  for (const [path, data] of Object.entries(extras)) pkg[path] = [data, { level: /\.(png|jpe?g)$/i.test(path) ? 0 : 6 }];
  return {
    fileName: `${safe} (InDesign).zip`,
    contentType: 'application/zip',
    data: zipSync(pkg),
    idml,
    extras,
    idmlName,
    pages: result.pages,
    warnings: result.warnings,
  };

  function read(path: string): string | null {
    const p = path.replace(/^\.\//, '');
    return texts.get(dir + p) ?? texts.get(p) ?? null;
  }
}

/** An .idml: a ZIP whose first entry is the uncompressed `mimetype`. */
export function zipParts(parts: Record<string, string>): Uint8Array {
  const z: Zippable = { mimetype: [strToU8(parts.mimetype ?? 'application/vnd.adobe.indesign-idml-package'), { level: 0 }] };
  for (const [path, text] of Object.entries(parts)) if (path !== 'mimetype') z[path] = [strToU8(text), { level: 6 }];
  return zipSync(z);
}
