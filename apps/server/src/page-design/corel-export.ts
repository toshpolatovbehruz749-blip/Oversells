import type { PrismaClient } from '@prisma/client';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { COVER_FILE, readCover } from '@oversells/shared';
import type { DocManager } from '../collab/doc-manager.js';
import type { CompileService } from '../compile/compile-service.js';
import type { Storage } from '../storage/storage.js';
import { AppError } from '../errors.js';

export interface CorelExport {
  /** `${name} (CorelDRAW).zip` */
  fileName: string;
  /** The project's name as a folder and file name. */
  name: string;
  data: Uint8Array;
  /** The cover was in the project but could not be compiled (the package has the book only). */
  coverFailed: boolean;
}

/**
 * The project for CorelDRAW. Its own .cdr format is closed (only CorelDRAW writes it), but
 * CorelDRAW opens a PDF as an editable document: text stays text (in the fonts installed on the
 * computer), pictures stay pictures. So the package is the book's latest PDF, the cover's PDF
 * when the project has one, the original pictures and uploaded fonts, and a short guide in Uzbek.
 * `.oversells` tells the Mac helper which program opens it.
 */
export async function buildCorelExport(
  deps: { prisma: PrismaClient; docs: DocManager; storage: Storage; compile: CompileService },
  projectId: string,
): Promise<CorelExport> {
  const project = await deps.prisma.project.findUnique({ where: { id: projectId }, include: { files: true } });
  if (!project) throw new AppError(404, 'not_found', 'Project not found');
  // The PDF of the latest compile; one still running is waited for.
  let job = await deps.compile.latest(projectId);
  const deadline = Date.now() + 5 * 60_000;
  while (job && (job.status === 'queued' || job.status === 'running') && Date.now() < deadline) {
    job = await deps.compile.waitForChange(projectId, job.id, job.status, 25_000);
  }
  if (!job?.pdfKey || job.status !== 'success') throw new AppError(422, 'no_pdf', 'Compile the project first');
  const name = project.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim() || 'Kitob';
  const pkg: Zippable = {
    '.oversells': strToU8('app=coreldraw\n'),
    [`${name}.pdf`]: [new Uint8Array(await deps.storage.get(job.pdfKey)), { level: 6 }],
  };

  // The cover, compiled now from muqova.tex (as the «Muqova PDF» button does).
  let coverFailed = false;
  const cover = project.files.find((f) => f.path === COVER_FILE && f.kind === 'text');
  if (cover && readCover(await deps.docs.getText(cover.id)) !== null) {
    await deps.docs.flushProject(projectId);
    const files = await Promise.all(project.files.map(async (f) => ({ path: f.path, data: await deps.storage.get(f.storageKey) })));
    const result = await deps.compile.render(`corel-cover-${projectId}-${Date.now()}`, files, project.compiler === 'lualatex' ? 'lualatex' : 'xelatex', COVER_FILE);
    if (result.status === 'success' && result.pdf) pkg[`${name} - muqova.pdf`] = [new Uint8Array(result.pdf), { level: 6 }];
    else coverFailed = true;
  }

  // Original pictures (to swap a low-resolution import for the full one) and uploaded fonts.
  const fonts: string[] = [];
  for (const f of project.files) {
    if (f.kind !== 'binary') continue;
    if (/\.(png|jpe?g|tiff?|pdf|eps|svg)$/i.test(f.path)) pkg[`Rasmlar/${f.path}`] = [new Uint8Array(await deps.storage.get(f.storageKey)), { level: 0 }];
    else if (/\.(otf|ttf)$/i.test(f.path)) {
      const base = f.path.slice(f.path.lastIndexOf('/') + 1);
      fonts.push(base);
      pkg[`Shriftlar/${base}`] = [new Uint8Array(await deps.storage.get(f.storageKey)), { level: 6 }];
    }
  }
  const main = project.files.find((f) => f.path === project.mainFile && f.kind === 'text');
  const mainFont = main ? /\\setmainfont\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/.exec(await deps.docs.getText(main.id))?.[1] : undefined;
  pkg['OQING.txt'] = strToU8(guide(name, !!pkg[`${name} - muqova.pdf`], coverFailed, fonts, mainFont ?? null));
  return { fileName: `${name} (CorelDRAW).zip`, name, data: zipSync(pkg), coverFailed };
}

function guide(name: string, cover: boolean, coverFailed: boolean, fonts: string[], mainFont: string | null): string {
  return [
    `«${name}» — CorelDRAW uçun paket (Oversells)`,
    '',
    `1. CorelDRAW'da File → Open (Fayl → Oçiş) bilan «${name}.pdf» ni oçing.`,
    '   Import oynasida «Import text as: Text» (matnni matn qilib) ni tanlang —',
    '   şunda matnni tahrirlaş mumkin böladi. Har bir bet alohida sahifa bölib oçiladi.',
    cover ? `2. Muqova: «${name} - muqova.pdf» (orqa muqova, umurtqa va old muqova bitta yoyilmada).` : coverFailed ? '2. Muqova: loyihada muqova bor, lekin kompilyatsiya bölmadi — Oversells\'da «Muqova PDF» ni tekşiring.' : '2. Muqova: loyihada muqova yöq («Sahifa» → «Muqova» bölimida yaratiş mumkin).',
    '3. «Rasmlar» papkasida rasmlarning asl fayllari: CorelDRAW PDF\'dagi rasmni',
    '   sifatini yöqotmasdan almaştiriş kerak bölsa, şulardan foydalaning.',
    fonts.length
      ? `4. «Shriftlar» papkasidagi şriftlarni (${fonts.join(', ')}) avval kompyuterga örnating.`
      : '4. Loyihaga yuklangan şrift yöq.',
    `   Kitob şrifti${mainFont ? ` (${mainFont})` : ''} kompyuterda örnatilmagan bölsa, CorelDRAW matnni boşqa`,
    '   şrift bilan körsatadi. Noto şriftlari bepul: fonts.google.com.',
    '',
    'CorelDRAW\'ning öz .cdr formati yopiq, uni faqat CorelDRAW özi yozadi: tahrirdan keyin',
    'CorelDRAW\'da File → Save As bilan .cdr qilib saqlang.',
    '',
  ].join('\r\n');
}
