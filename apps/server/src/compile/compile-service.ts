import { Prisma, type CompileJob, type PrismaClient } from '@prisma/client';
import { notFound } from '../errors.js';
import type { CompileProcessor } from './processor.js';
import { CHANNEL_DONE, CHANNEL_QUEUED, type PgNotifier } from './notifier.js';

export type CompileMode = 'inline' | 'queue';

export interface CompileServiceOptions {
  /**
   * inline: jobs run in this process (needs the Docker socket);
   * queue: jobs are queued in PostgreSQL and run by the compile worker service.
   */
  mode: CompileMode;
  /** Called before the files of a project are read (flushes live documents). */
  beforeCompile?(projectId: string): Promise<void>;
  /** Parallel jobs in inline mode. */
  concurrency: number;
  /** Runs jobs (inline mode only). */
  processor?: CompileProcessor;
  /** Finished-job notifications (queue mode); polling is the fallback. */
  notifier?: PgNotifier;
  /** How often to poll for a finished job in queue mode. */
  pollMs?: number;
}

const TERMINAL = new Set(['success', 'failed', 'timeout', 'error']);

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
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
 * Compile requests. One active (queued or running) job per project, enforced
 * by a partial unique index, so concurrent requests from any app instance
 * join the active job.
 */
export class CompileService {
  private readonly semaphore: Semaphore;
  /** Inline mode: projectId -> the active job's creation and completion. */
  private readonly active = new Map<string, { created: Promise<CompileJob>; done: Promise<CompileJob> }>();
  /** Queue mode: jobId -> callbacks waiting for its completion notice. */
  private readonly waiting = new Map<string, Set<() => void>>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly opts: CompileServiceOptions,
  ) {
    this.semaphore = new Semaphore(opts.concurrency);
    if (opts.mode === 'inline' && !opts.processor) throw new Error('Inline compile mode needs a processor');
    opts.notifier?.on(CHANNEL_DONE, (jobId) => {
      for (const wake of this.waiting.get(jobId) ?? []) wake();
    });
  }

  get mode(): CompileMode {
    return this.opts.mode;
  }

  /** Inline mode: marks jobs interrupted by a restart as failed. Call once at start-up. */
  async recoverInterruptedJobs(): Promise<number> {
    if (this.opts.mode !== 'inline') return 0;
    const res = await this.prisma.compileJob.updateMany({
      where: { status: { in: ['queued', 'running'] } },
      data: { status: 'error', errorMessage: 'Interrupted by a server restart', finishedAt: new Date() },
    });
    return res.count;
  }

  /** Starts (or joins) a compile of the project. Returns the job and a promise of its completion. */
  async request(projectId: string): Promise<{ job: CompileJob; done: Promise<CompileJob> }> {
    if (this.opts.mode === 'queue') {
      await this.opts.beforeCompile?.(projectId);
      const { job, created } = await this.createOrJoin(projectId);
      if (created) await this.opts.notifier?.notify(CHANNEL_QUEUED, job.id).catch(() => undefined);
      return { job, done: this.waitFor(job.id) };
    }

    let entry = this.active.get(projectId);
    if (!entry) {
      // Registered synchronously, so concurrent requests always join this entry.
      const created = this.createOrJoin(projectId);
      const done = created.then(({ job, created: mine }) => (mine ? this.processInline(job) : this.waitFor(job.id)));
      const newEntry = { created: created.then((c) => c.job), done };
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

  private async createOrJoin(projectId: string): Promise<{ job: CompileJob; created: boolean }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound('Project');
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const job = await this.prisma.compileJob.create({
          data: { projectId, compiler: project.compiler, mainFile: project.mainFile, status: 'queued' },
        });
        return { job, created: true };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const active = await this.prisma.compileJob.findFirst({
          where: { projectId, status: { in: ['queued', 'running'] } },
        });
        if (active) return { job: active, created: false };
        // It finished in between; try again.
      }
    }
    throw new Error('Could not queue the compile job');
  }

  /** Resolves when the job finished (notification or polling). */
  private async waitFor(jobId: string): Promise<CompileJob> {
    const pollMs = this.opts.pollMs ?? 1000;
    for (;;) {
      const job = await this.prisma.compileJob.findUnique({ where: { id: jobId } });
      if (!job) throw notFound('Compile job');
      if (TERMINAL.has(job.status)) return job;
      await new Promise<void>((resolve) => {
        let set = this.waiting.get(jobId);
        if (!set) this.waiting.set(jobId, (set = new Set()));
        const wake = () => {
          clearTimeout(timer);
          set!.delete(wake);
          if (set!.size === 0) this.waiting.delete(jobId);
          resolve();
        };
        const timer = setTimeout(wake, pollMs);
        set.add(wake);
      });
    }
  }

  async get(projectId: string, jobId: string): Promise<CompileJob> {
    const job = await this.prisma.compileJob.findFirst({ where: { id: jobId, projectId } });
    if (!job) throw notFound('Compile job');
    return job;
  }

  /** Newest job of the project, or null if it was never compiled. */
  async latest(projectId: string): Promise<CompileJob | null> {
    if (!(await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }))) {
      throw notFound('Project');
    }
    return this.prisma.compileJob.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' } });
  }

  /** Runs work that needs a compile slot (respects COMPILE_CONCURRENCY). */
  async withSlot<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.semaphore.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /** Waits for all jobs this process runs (used on shutdown and in tests). */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.active.values()].map((a) => a.done));
  }

  private async processInline(job: CompileJob): Promise<CompileJob> {
    const release = await this.semaphore.acquire();
    const startedAt = new Date();
    try {
      await this.prisma.compileJob.update({ where: { id: job.id }, data: { status: 'running', startedAt } });
      try {
        await this.opts.beforeCompile?.(job.projectId);
      } catch {
        // Compile what is stored; the editor keeps saving.
      }
      return await this.opts.processor!.run(job, startedAt);
    } finally {
      release();
    }
  }
}
