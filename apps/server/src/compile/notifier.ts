import pg from 'pg';
import type { PrismaClient } from '@prisma/client';

/** NOTIFY channels of the compile queue. */
export const CHANNEL_QUEUED = 'oversells_compile_queued';
export const CHANNEL_DONE = 'oversells_compile_done';

interface Log {
  warn(obj: unknown, msg?: string): void;
}

/**
 * PostgreSQL LISTEN/NOTIFY for the compile queue: workers wake up when a job
 * is queued, apps learn when a job finished. Notifications are only a
 * latency optimisation; both sides also poll, so a lost notification (or a
 * dropped LISTEN connection, which is re-established) only delays things.
 */
export class PgNotifier {
  private client: pg.Client | null = null;
  private readonly handlers = new Map<string, Set<(payload: string) => void>>();
  private closed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly databaseUrl: string,
    private readonly prisma: PrismaClient,
    private readonly log: Log,
  ) {}

  on(channel: string, handler: (payload: string) => void): () => void {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      if (this.client) void this.client.query(`LISTEN ${channel}`).catch(() => undefined);
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  async start(): Promise<void> {
    if (this.closed) return;
    const client = new pg.Client({ connectionString: stripPrismaParams(this.databaseUrl) });
    client.on('notification', (n) => {
      for (const h of this.handlers.get(n.channel) ?? []) h(n.payload ?? '');
    });
    const reconnect = (err?: Error) => {
      if (this.closed || this.client !== client) return;
      this.client = null;
      if (err) this.log.warn({ err }, 'LISTEN connection lost; reconnecting');
      client.end().catch(() => undefined);
      this.reconnectTimer = setTimeout(() => void this.start().catch((e: Error) => reconnect(e)), 1000);
    };
    client.on('error', reconnect);
    client.on('end', () => reconnect());
    try {
      await client.connect();
      for (const channel of this.handlers.keys()) await client.query(`LISTEN ${channel}`);
      this.client = client;
    } catch (err) {
      await client.end().catch(() => undefined);
      if (this.closed) return;
      this.log.warn({ err }, 'Could not LISTEN for compile notifications; retrying');
      this.reconnectTimer = setTimeout(() => void this.start().catch(() => undefined), 2000);
    }
  }

  /** Sends a notification (through Prisma, so no extra connection is needed). */
  async notify(channel: string, payload = ''): Promise<void> {
    await this.prisma.$executeRaw`SELECT pg_notify(${channel}, ${payload})`;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const c = this.client;
    this.client = null;
    await c?.end().catch(() => undefined);
  }
}

/** Prisma-only URL parameters (schema, connection_limit, ...) mean nothing to node-postgres. */
export function stripPrismaParams(url: string): string {
  const u = new URL(url);
  for (const p of ['schema', 'connection_limit', 'pool_timeout', 'pgbouncer', 'statement_cache_size', 'socket_timeout']) {
    u.searchParams.delete(p);
  }
  return u.toString();
}
