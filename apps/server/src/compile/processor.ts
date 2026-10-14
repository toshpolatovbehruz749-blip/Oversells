import { createHash } from 'node:crypto';
import type { CompileJob, PrismaClient, Prisma } from '@prisma/client';
import type { LogEntry } from '@oversells/shared';
import { keys, type Storage } from '../storage/storage.js';
import type { CompileInputFile } from './runner.js';

/** Storage keys of a render job (a preview of files that do not belong to a project). */
export const renderKeys = {
  input: (key: string) => `renders/${key}/input.json`,
  pdf: (key: string) => `renders/${key}/output.pdf`,
  png: (key: string) => `renders/${key}/preview.png`,
  log: (key: string) => `renders/${key}/output.log`,
};

export function encodeRenderInput(files: CompileInputFile[]): Buffer {
  return Buffer.from(JSON.stringify({ files: files.map((f) => ({ path: f.path, data: f.data.toString('base64') })) }));
}

function decodeRenderInput(raw: Buffer): CompileInputFile[] {
  const parsed = JSON.parse(raw.toString('utf8')) as { files: Array<{ path: string; data: string }> };
  return parsed.files.map((f) => ({ path: f.path, data: Buffer.from(f.data, 'base64') }));
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
        const cacheKey = this.cacheKey(job, projectId);
        const cache = (await this.storage.exists(cacheKey)) ? await this.storage.get(cacheKey) : null;
        result = await this.runner.run({ jobId: job.id, compiler: job.compiler, mainFile: job.mainFile, files: inputs, cache });
        await this.saveCache(job, projectId, result);
      }
      return await this.finish(job, projectId, startedAt, result);
    } catch (err) {
      return this.fail(job, startedAt, err as Error);
    }
  }

  /** One cache per project, named after the compiler and main file it belongs to. */
  private cacheKey(job: CompileJob, projectId: string): string {
    const main = createHash('sha256').update(job.mainFile).digest('hex').slice(0, 16);
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
      const files = decodeRenderInput(await this.storage.get(renderKeys.input(key)));
      const result = await this.runner.run({ jobId: job.id, compiler: job.compiler, mainFile: job.mainFile, files, preview: true });
      if (result.pdf) await this.storage.put(renderKeys.pdf(key), result.pdf);
      if (result.preview) await this.storage.put(renderKeys.png(key), result.preview);
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
