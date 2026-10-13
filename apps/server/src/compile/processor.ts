import type { CompileJob, PrismaClient, Prisma } from '@prisma/client';
import type { LogEntry } from '@oversells/shared';
import { keys, type Storage } from '../storage/storage.js';
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
    try {
      const files = await this.prisma.projectFile.findMany({ where: { projectId: job.projectId } });
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
        result = await this.runner.run({ jobId: job.id, compiler: job.compiler, mainFile: job.mainFile, files: inputs });
      }
      return await this.finish(job, startedAt, result);
    } catch (err) {
      const updated = await this.prisma.compileJob.update({
        where: { id: job.id },
        data: {
          status: 'error',
          errorMessage: `Internal error: ${(err as Error).message}`,
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
        },
      });
      metrics.compiles.inc({ status: 'error' });
      return updated;
    }
  }

  private async finish(job: CompileJob, startedAt: Date, result: CompileResult): Promise<CompileJob> {
    const entries: LogEntry[] = result.log ? parseLatexLog(result.log) : [];

    let pdfKey: string | null = null;
    if (result.pdf) {
      pdfKey = keys.outputPdf(job.projectId, job.id);
      await this.storage.put(pdfKey, result.pdf);
    }
    let synctexKey: string | null = null;
    if (result.pdf && result.synctex) {
      synctexKey = keys.outputSynctex(job.projectId, job.id);
      await this.storage.put(synctexKey, result.synctex);
    }
    const fullLog = [result.log ?? '', '', '===== latexmk =====', result.console].join('\n');
    const logKey = keys.outputLog(job.projectId, job.id);
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
    await this.pruneOutputs(job.projectId);
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
