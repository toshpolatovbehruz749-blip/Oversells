import { createHash } from 'node:crypto';
import type { CompileJob, PrismaClient, Prisma } from '@prisma/client';
import { chapterPreview, previewPath, type ChapterPreview, type LogEntry } from '@oversells/shared';
import { keys, type Storage } from '../storage/storage.js';
import type { CompileInputFile, ConvertMode } from './runner.js';
import { packFiles } from './docker-runner.js';

/** Storage keys of a render job (a preview of files that do not belong to a project). */
export const renderKeys = {
  input: (key: string) => `renders/${key}/input.json`,
  pdf: (key: string) => `renders/${key}/output.pdf`,
  png: (key: string) => `renders/${key}/preview.png`,
  log: (key: string) => `renders/${key}/output.log`,
  /** Result files of a conversion (tar). */
  out: (key: string) => `renders/${key}/output.tar`,
};

export function encodeRenderInput(files: CompileInputFile[], convert?: ConvertMode): Buffer {
  return Buffer.from(
    JSON.stringify({ convert, files: files.map((f) => ({ path: f.path, data: f.data.toString('base64') })) }),
  );
}

function decodeRenderInput(raw: Buffer): { files: CompileInputFile[]; convert?: ConvertMode } {
  const parsed = JSON.parse(raw.toString('utf8')) as { convert?: ConvertMode; files: Array<{ path: string; data: string }> };
  return { convert: parsed.convert, files: parsed.files.map((f) => ({ path: f.path, data: Buffer.from(f.data, 'base64') })) };
}
import { parseLatexLog } from './log-parser.js';
import type { CompileResult, CompileRunner } from './runner.js';
import { metrics } from '../metrics.js';

/**
 * Runs one compile job: reads the project files from storage, runs the
 * sandbox, stores the outputs and records the result. Used in-process by the
 * app (inline mode) and by the compile worker service (queue mode).
 */
export class CompileProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: Storage,
    private readonly runner: CompileRunner,
    private readonly opts: { keepOutputs: number },
  ) {}

  /** Runs a job that is already marked as running. Never throws for job failures. */
  async run(job: CompileJob, startedAt: Date): Promise<CompileJob> {
    if (job.kind === 'render') return this.runRender(job, startedAt);
    const projectId = job.projectId!;
    try {
      const files = await this.prisma.projectFile.findMany({ where: { projectId } });
      const inputs = await Promise.all(files.map(async (f) => ({ path: f.path, data: await this.storage.get(f.storageKey) })));

      let result: CompileResult;
      if (!files.some((f) => f.path === job.mainFile)) {
        result = {
          status: 'failed',
          exitCode: null,
          log: null,
          console: '',
          pdf: null,
          synctex: null,
          errorMessage: `Main file ${job.mainFile} not found`,
        };
      } else {
        // "Faqat shu bob": the chapter is compiled as its own file next to the main file.
        let mainFile = job.mainFile;
        if (job.previewLine !== null) {
          const preview = this.chapterOf(job, inputs);
          job = await this.prisma.compileJob.update({
            where: { id: job.id },
            data: preview ? { previewLabel: preview.label.slice(0, 300) } : { previewFile: null, previewLine: null },
          });
          if (preview) {
            mainFile = previewPath(job.mainFile);
            inputs.push({ path: mainFile, data: Buffer.from(preview.text, 'utf8') });
          }
        }
        const cacheKey = this.cacheKey(job, projectId, mainFile);
        const cache = (await this.storage.exists(cacheKey)) ? await this.storage.get(cacheKey) : null;
        result = await this.runner.run({ jobId: job.id, compiler: job.compiler, mainFile, files: inputs, cache });
        await this.saveCache(job, projectId, result);
      }
      return await this.finish(job, projectId, startedAt, result);
    } catch (err) {
      return this.fail(job, startedAt, err as Error);
    }
  }

  /**
   * The chapter to compile: around the cursor line of the main file, or around
   * the line of the main file that \input-s the file with the cursor.
   */
  private chapterOf(job: CompileJob, inputs: Array<{ path: string; data: Buffer }>): ChapterPreview | null {
    const main = inputs.find((f) => f.path === job.mainFile);
    if (!main) return null;
    const text = main.data.toString('utf8');
    let line = job.previewLine!;
    if (job.previewFile && job.previewFile !== job.mainFile) {
      const dir = job.mainFile.includes('/') ? job.mainFile.slice(0, job.mainFile.lastIndexOf('/') + 1) : '';
      const rel = job.previewFile.startsWith(dir) ? job.previewFile.slice(dir.length) : job.previewFile;
      const name = rel.replace(/\.tex$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const at = text.split('\n').findIndex((l) => new RegExp(`^[^%]*\\\\(input|include|subfile)\\s*\\{\\s*${name}(\\.tex)?\\s*\\}`).test(l));
      if (at === -1) return null;
      line = at + 1;
    }
    return chapterPreview(text, line);
  }

  /** One cache per project, named after the compiler and main file it belongs to. */
  private cacheKey(job: CompileJob, projectId: string, mainFile = job.mainFile): string {
    const main = createHash('sha256').update(mainFile).digest('hex').slice(0, 16);
    return keys.compileCache(projectId, `${job.compiler}-${main}`);
  }

  /**
   * Keeps the auxiliary files of a successful compile so the next one needs
   * fewer LaTeX passes (big books); any other outcome drops them, so a broken
   * .aux never outlives the compile that wrote it.
   */
  private async saveCache(job: CompileJob, projectId: string, result: CompileResult): Promise<void> {
    try {
      await this.storage.deletePrefix(keys.compileCacheDir(projectId));
      if (result.status === 'success' && result.cache) await this.storage.put(this.cacheKey(job, projectId), result.cache);
    } catch {
      // The cache only saves time.
    }
  }

  /** A render job: sources from storage, outputs (PDF, first page PNG, log) back to storage. */
  private async runRender(job: CompileJob, startedAt: Date): Promise<CompileJob> {
    const key = job.renderKey!;
    try {
      const { files, convert } = decodeRenderInput(await this.storage.get(renderKeys.input(key)));
      const result = await this.runner.run({
        jobId: job.id,
        compiler: job.compiler,
        mainFile: job.mainFile,
        files,
        ...(convert ? { convert } : { preview: true }),
      });
      if (result.pdf) await this.storage.put(renderKeys.pdf(key), result.pdf);
      if (result.preview) await this.storage.put(renderKeys.png(key), result.preview);
      if (result.outputs?.length) await this.storage.put(renderKeys.out(key), await packFiles(result.outputs));
      await this.storage.put(renderKeys.log(key), Buffer.from(result.log ?? result.console, 'utf8'));
      const finishedAt = new Date();
      return await this.prisma.compileJob.update({
        where: { id: job.id },
        data: {
          status: result.status,
          exitCode: result.exitCode,
          errorMessage: result.errorMessage,
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          heartbeatAt: null,
        },
      });
    } catch (err) {
      return this.fail(job, startedAt, err as Error);
    }
  }

  private async fail(job: CompileJob, startedAt: Date, err: Error): Promise<CompileJob> {
    const updated = await this.prisma.compileJob.update({
      where: { id: job.id },
      data: {
        status: 'error',
        errorMessage: `Internal error: ${err.message}`,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
      },
    });
    metrics.compiles.inc({ status: 'error' });
    return updated;
  }

  private async finish(job: CompileJob, projectId: string, startedAt: Date, result: CompileResult): Promise<CompileJob> {
    const entries: LogEntry[] = result.log ? parseLatexLog(result.log) : [];

    let pdfKey: string | null = null;
    if (result.pdf) {
      pdfKey = keys.outputPdf(projectId, job.id);
      await this.storage.put(pdfKey, result.pdf);
    }
    let synctexKey: string | null = null;
    if (result.pdf && result.synctex) {
      synctexKey = keys.outputSynctex(projectId, job.id);
      await this.storage.put(synctexKey, result.synctex);
    }
    const fullLog = [result.log ?? '', '', '===== latexmk =====', result.console].join('\n');
    const logKey = keys.outputLog(projectId, job.id);
    await this.storage.put(logKey, Buffer.from(fullLog, 'utf8'));

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const updated = await this.prisma.compileJob.update({
      where: { id: job.id },
      data: {
        status: result.status,
        exitCode: result.exitCode,
        entries: entries as unknown as Prisma.InputJsonValue,
        errorMessage: result.errorMessage,
        pdfKey,
        logKey,
        synctexKey,
        finishedAt,
        durationMs,
        heartbeatAt: null,
      },
    });
    metrics.compiles.inc({ status: result.status });
    metrics.compileSeconds.observe({ status: result.status }, durationMs / 1000);
    await this.pruneOutputs(projectId);
    return updated;
  }

  /** Deletes stored outputs of all but the newest `keepOutputs` finished jobs. */
  private async pruneOutputs(projectId: string): Promise<void> {
    const old = await this.prisma.compileJob.findMany({
      where: { projectId, OR: [{ pdfKey: { not: null } }, { logKey: { not: null } }] },
      orderBy: { createdAt: 'desc' },
      skip: this.opts.keepOutputs,
      select: { id: true },
    });
    for (const { id } of old) {
      await this.storage.deletePrefix(keys.output(projectId, id));
      await this.prisma.compileJob.update({ where: { id }, data: { pdfKey: null, logKey: null, synctexKey: null } });
    }
  }
}
