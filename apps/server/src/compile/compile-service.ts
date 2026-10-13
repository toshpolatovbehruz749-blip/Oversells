import type { CompileJob, PrismaClient, Prisma } from '@prisma/client';
import type { LogEntry } from '@oversells/shared';
import { notFound } from '../errors.js';
import { keys, type Storage } from '../storage/storage.js';
import { parseLatexLog } from './log-parser.js';
import type { CompileResult, CompileRunner } from './runner.js';

export interface CompileServiceOptions {
  concurrency: number;
  /** How many jobs per project keep their PDF/log in storage. */
  keepOutputs: number;
}

/** Minimal FIFO semaphore limiting how many jobs run at once. */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  get running(): number {
    return this.active;
  }

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    } else {
      this.active++;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    };
  }
}

/**
 * Owns the compile queue. One active (queued or running) job per project;
 * a request while one is active returns that job.
 */
export class CompileService {
  private readonly semaphore: Semaphore;
  /** projectId -> promise of the active job's completion. */
  private readonly active = new Map<string, { created: Promise<CompileJob>; done: Promise<CompileJob> }>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: Storage,
    private readonly runner: CompileRunner,
    private readonly opts: CompileServiceOptions,
  ) {
    this.semaphore = new Semaphore(opts.concurrency);
  }

  /** Marks jobs interrupted by a restart as failed. Call once at start-up. */
  async recoverInterruptedJobs(): Promise<number> {
    const res = await this.prisma.compileJob.updateMany({
      where: { status: { in: ['queued', 'running'] } },
      data: { status: 'error', errorMessage: 'Interrupted by a server restart', finishedAt: new Date() },
    });
    return res.count;
  }

  /** Starts (or joins) a compile of the project. Returns the job and a promise of its completion. */
  async request(projectId: string): Promise<{ job: CompileJob; done: Promise<CompileJob> }> {
    let entry = this.active.get(projectId);
    if (!entry) {
      // Registered synchronously, so concurrent requests always join this entry.
      const created = this.createJob(projectId);
      const done = created.then((job) => this.process(job));
      const newEntry = { created, done };
      entry = newEntry;
      this.active.set(projectId, newEntry);
      done
        .finally(() => {
          if (this.active.get(projectId) === newEntry) this.active.delete(projectId);
        })
        .catch(() => undefined);
    }
    const job = await entry.created;
    const fresh = await this.prisma.compileJob.findUniqueOrThrow({ where: { id: job.id } });
    return { job: fresh, done: entry.done };
  }

  private async createJob(projectId: string): Promise<CompileJob> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound('Project');
    return this.prisma.compileJob.create({
      data: { projectId, compiler: project.compiler, mainFile: project.mainFile, status: 'queued' },
    });
  }

  async get(projectId: string, jobId: string): Promise<CompileJob> {
    const job = await this.prisma.compileJob.findFirst({ where: { id: jobId, projectId } });
    if (!job) throw notFound('Compile job');
    return job;
  }

  async latest(projectId: string): Promise<CompileJob> {
    const job = await this.prisma.compileJob.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    if (!job) throw notFound('Compile job');
    return job;
  }

  /** Waits for all active jobs (used on shutdown and in tests). */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.active.values()].map((a) => a.done));
  }

  private async process(job: CompileJob): Promise<CompileJob> {
    const release = await this.semaphore.acquire();
    const startedAt = new Date();
    try {
      await this.prisma.compileJob.update({ where: { id: job.id }, data: { status: 'running', startedAt } });

      const files = await this.prisma.projectFile.findMany({ where: { projectId: job.projectId } });
      const inputs = await Promise.all(
        files.map(async (f) => ({ path: f.path, data: await this.storage.get(f.storageKey) })),
      );

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
        result = await this.runner.run({
          jobId: job.id,
          compiler: job.compiler,
          mainFile: job.mainFile,
          files: inputs,
        });
      }
      return await this.finish(job, startedAt, result);
    } catch (err) {
      return this.prisma.compileJob.update({
        where: { id: job.id },
        data: {
          status: 'error',
          errorMessage: `Internal error: ${(err as Error).message}`,
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
        },
      });
    } finally {
      release();
    }
  }

  private async finish(job: CompileJob, startedAt: Date, result: CompileResult): Promise<CompileJob> {
    const entries: LogEntry[] = result.log ? parseLatexLog(result.log) : [];

    let pdfKey: string | null = null;
    if (result.pdf) {
      pdfKey = keys.outputPdf(job.projectId, job.id);
      await this.storage.put(pdfKey, result.pdf);
    }
    const fullLog = [result.log ?? '', '', '===== latexmk =====', result.console].join('\n');
    const logKey = keys.outputLog(job.projectId, job.id);
    await this.storage.put(logKey, Buffer.from(fullLog, 'utf8'));

    const finishedAt = new Date();
    const updated = await this.prisma.compileJob.update({
      where: { id: job.id },
      data: {
        status: result.status,
        exitCode: result.exitCode,
        entries: entries as unknown as Prisma.InputJsonValue,
        errorMessage: result.errorMessage,
        pdfKey,
        logKey,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      },
    });
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
      await this.prisma.compileJob.update({ where: { id }, data: { pdfKey: null, logKey: null } });
    }
  }
}
