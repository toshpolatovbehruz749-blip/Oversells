import type { PrismaClient } from '@prisma/client';
import type { Storage } from './storage/storage.js';
import { applyVersionRetention } from './versions/retention.js';

interface Log {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

/** Arbitrary constant for pg_try_advisory_lock: only one instance runs maintenance at a time. */
const MAINTENANCE_LOCK = 724_355_001;

/**
 * Periodic housekeeping: version retention, expired sessions and reset
 * tokens. Safe with several app instances (an advisory lock elects one).
 */
export class Maintenance {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: Storage,
    private readonly log: Log,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    // First run shortly after start-up, then on the interval.
    this.timer = setTimeout(() => void this.tick(), Math.min(60_000, this.intervalMs));
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    try {
      await this.runOnce();
    } finally {
      if (this.timer) this.timer = setTimeout(() => void this.tick(), this.intervalMs);
    }
  }

  /** Runs all tasks if no other instance is running them; returns null when skipped. */
  async runOnce(now = new Date()): Promise<{ versions: number; sessions: number; resetTokens: number } | null> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(${MAINTENANCE_LOCK}) AS locked`;
        if (!rows[0]?.locked) return null;
        try {
          const versions = await applyVersionRetention(this.prisma, this.storage, now);
          const sessions = (await this.prisma.session.deleteMany({ where: { expiresAt: { lt: now } } })).count;
          const resetTokens = (await this.prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } })).count;
          if (versions + sessions + resetTokens > 0) this.log.info({ versions, sessions, resetTokens }, 'Maintenance done');
          return { versions, sessions, resetTokens };
        } catch (err) {
          this.log.warn({ err }, 'Maintenance failed');
          return null;
        }
      },
      { timeout: 10 * 60_000 },
    );
  }
}
