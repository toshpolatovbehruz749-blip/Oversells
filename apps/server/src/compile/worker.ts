import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { CompileJob, PrismaClient } from '@prisma/client';
import type { CompileProcessor } from './processor.js';
import { CHANNEL_DONE, CHANNEL_QUEUED, type PgNotifier } from './notifier.js';

export interface CompileWorkerOptions {
  concurrency: number;
  /** How often running jobs and the worker itself report they are alive. */
  heartbeatMs: number;
  /** A running job whose heartbeat is older than this is considered lost. */
  staleMs: number;
  /** Lost jobs are queued again until they have been tried this many times. */
  maxAttempts: number;
  /** Poll for queued jobs this often even without notifications. */
  pollMs: number;
}

interface Log {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/**
 * The compile worker service: takes queued jobs from PostgreSQL
 * (`FOR UPDATE SKIP LOCKED`, so any number of workers can share the queue),
 * runs them in the Docker sandbox, and notifies the apps. Running jobs send
 * heartbeats; jobs of a worker that died are re-queued by any other worker.
 */
export class CompileWorker {
  readonly id = `${hostname()}-${process.pid}-${randomBytes(3).toString('hex')}`;
  private readonly running = new Map<string, Promise<void>>();
  private stopping = false;
  private wake: (() => void) | null = null;
  private loop: Promise<void> | null = null;
  private timers: NodeJS.Timeout[] = [];
  private offQueued: (() => void) | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly processor: CompileProcessor,
    private readonly notifier: PgNotifier | null,
    private readonly opts: CompileWorkerOptions,
    private readonly log: Log,
  ) {}

  get activeJobs(): number {
    return this.running.size;
  }

  async start(): Promise<void> {
    await this.prisma.compileWorker.upsert({
      where: { id: this.id },
      create: { id: this.id, hostname: hostname(), concurrency: this.opts.concurrency },
      update: { heartbeatAt: new Date() },
    });
    this.offQueued = this.notifier?.on(CHANNEL_QUEUED, () => this.wakeUp()) ?? null;
    this.timers.push(setInterval(() => void this.heartbeat(), this.opts.heartbeatMs));
    this.timers.push(setInterval(() => void this.reap(), Math.max(1000, Math.floor(this.opts.staleMs / 2))));
    await this.reap();
    this.loop = this.run();
    this.log.info({ workerId: this.id, concurrency: this.opts.concurrency }, 'Compile worker started');
  }

  /** Stops taking jobs, lets running jobs finish, and deregisters. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.wakeUp();
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.offQueued?.();
    await this.loop;
    await Promise.allSettled(this.running.values());
    await this.prisma.compileWorker.deleteMany({ where: { id: this.id } });
  }

  private wakeUp(): void {
    const w = this.wake;
    this.wake = null;
    w?.();
  }

  private async run(): Promise<void> {
    while (!this.stopping) {
      try {
        while (!this.stopping && this.running.size < this.opts.concurrency) {
          const job = await this.claim();
          if (!job) break;
          const p = this.process(job).finally(() => {
            this.running.delete(job.id);
            this.wakeUp();
          });
          this.running.set(job.id, p);
        }
      } catch (err) {
        this.log.error({ err }, 'Could not take a compile job');
      }
      if (this.stopping) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.wake = null;
          resolve();
        }, this.opts.pollMs);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  }

  /** Atomically takes the oldest queued job. */
  async claim(): Promise<CompileJob | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "CompileJob"
      SET "status" = 'running', "startedAt" = now(), "workerId" = ${this.id}, "heartbeatAt" = now(),
          "attempts" = "attempts" + 1
      WHERE "id" = (
        SELECT "id" FROM "CompileJob" WHERE "status" = 'queued'
        ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
      )
      RETURNING "id"`;
    if (rows.length === 0) return null;
    return this.prisma.compileJob.findUnique({ where: { id: rows[0]!.id } });
  }

  private async process(job: CompileJob): Promise<void> {
    try {
      const done = await this.processor.run(job, job.startedAt ?? new Date());
      this.log.info({ jobId: job.id, projectId: job.projectId, status: done.status, durationMs: done.durationMs }, 'Compile finished');
    } catch (err) {
      // The project was probably deleted while compiling.
      this.log.warn({ err, jobId: job.id }, 'Compile job could not be completed');
    } finally {
      await this.notifier?.notify(CHANNEL_DONE, job.id).catch(() => undefined);
    }
  }

  private async heartbeat(): Promise<void> {
    try {
      await this.prisma.compileWorker.upsert({
        where: { id: this.id },
        create: { id: this.id, hostname: hostname(), concurrency: this.opts.concurrency },
        update: { heartbeatAt: new Date() },
      });
      if (this.running.size > 0) {
        await this.prisma.compileJob.updateMany({
          where: { id: { in: [...this.running.keys()] }, status: 'running' },
          data: { heartbeatAt: new Date() },
        });
      }
    } catch (err) {
      this.log.warn({ err }, 'Compile worker heartbeat failed');
    }
  }

  /** Re-queues (or fails) jobs whose worker stopped sending heartbeats. */
  async reap(): Promise<number> {
    try {
      const staleBefore = new Date(Date.now() - this.opts.staleMs);
      const lost = await this.prisma.$queryRaw<Array<{ id: string; status: string }>>`
        UPDATE "CompileJob"
        SET "status" = CASE WHEN "attempts" >= ${this.opts.maxAttempts} THEN 'error'::"CompileStatus" ELSE 'queued'::"CompileStatus" END,
            "errorMessage" = CASE WHEN "attempts" >= ${this.opts.maxAttempts} THEN 'The compile worker stopped responding' ELSE NULL END,
            "finishedAt" = CASE WHEN "attempts" >= ${this.opts.maxAttempts} THEN now() ELSE NULL END,
            "workerId" = NULL, "heartbeatAt" = NULL
        WHERE "status" = 'running' AND "heartbeatAt" IS NOT NULL AND "heartbeatAt" < ${staleBefore}
        RETURNING "id", "status"::text`;
      await this.prisma.compileWorker.deleteMany({
        where: { heartbeatAt: { lt: new Date(Date.now() - 10 * this.opts.staleMs) } },
      });
      for (const job of lost) {
        this.log.warn({ jobId: job.id, status: job.status }, 'Compile job of a lost worker recovered');
        await this.notifier?.notify(job.status === 'queued' ? CHANNEL_QUEUED : CHANNEL_DONE, job.id).catch(() => undefined);
      }
      if (lost.some((j) => j.status === 'queued')) this.wakeUp();
      return lost.length;
    } catch (err) {
      this.log.warn({ err }, 'Could not check for lost compile jobs');
      return 0;
    }
  }
}
