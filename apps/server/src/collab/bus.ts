import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';

/**
 * Messages between app instances about one document. Binary payloads are
 * base64 so messages are plain JSON.
 *  - update:    a Yjs update made on the sending instance
 *  - awareness: cursors/presence of the sender's clients
 *  - sync-req:  "I just loaded the document, here is my state vector"
 *  - sync-res:  the answer to a sync-req (only for `to`)
 */
export type DocBusMessage =
  | { t: 'update'; from: string; data: string }
  | { t: 'awareness'; from: string; data: string }
  | { t: 'sync-req'; from: string; sv: string }
  | { t: 'sync-res'; from: string; to: string; data: string };

/** Criteria for closing live connections (OR): a user, a share token, or projects. */
export interface CloseCriteria {
  userId?: string;
  shareToken?: string;
  projectIds?: string[];
}

/** Cluster-wide messages that are not about one document. */
export type ControlMessage =
  | { t: 'flush'; from: string; projectId: string; reqId: string }
  | { t: 'flushed'; from: string; to: string; reqId: string }
  | { t: 'close'; from: string; criteria: CloseCriteria; code: number; reason: string }
  | { t: 'drop'; from: string; fileIds: string[] };

export interface DocBus {
  readonly instanceId: string;
  subscribeDoc(fileId: string, handler: (m: DocBusMessage) => void): Promise<void>;
  unsubscribeDoc(fileId: string): Promise<void>;
  publishDoc(fileId: string, m: DocBusMessage): void;
  onControl(handler: (m: ControlMessage) => void): void;
  publishControl(m: ControlMessage): void;
  /** Number of other app instances that are alive. */
  peers(): Promise<number>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface RedisDocBusOptions {
  url: string;
  /** Key and channel prefix (several deployments or tests can share one Redis). */
  prefix: string;
  heartbeatMs?: number;
}

interface Log {
  warn(obj: unknown, msg?: string): void;
}

/** DocBus over Redis pub/sub, with an instance registry for counting peers. */
export class RedisDocBus implements DocBus {
  readonly instanceId = randomBytes(8).toString('hex');
  private readonly pub: Redis;
  private readonly sub: Redis;
  private readonly docHandlers = new Map<string, (m: DocBusMessage) => void>();
  private readonly controlHandlers: Array<(m: ControlMessage) => void> = [];
  private readonly heartbeat: NodeJS.Timeout;
  private readonly heartbeatMs: number;

  constructor(
    private readonly opts: RedisDocBusOptions,
    private readonly log: Log,
  ) {
    this.heartbeatMs = opts.heartbeatMs ?? 5000;
    this.pub = new Redis(opts.url, { maxRetriesPerRequest: 2, lazyConnect: false });
    this.sub = new Redis(opts.url, { maxRetriesPerRequest: null });
    for (const c of [this.pub, this.sub]) c.on('error', (err) => this.log.warn({ err }, 'Redis connection error'));
    this.sub.on('message', (channel: string, raw: string) => this.dispatch(channel, raw));
    void this.sub.subscribe(this.controlChannel).catch((err: Error) => this.log.warn({ err }, 'Redis subscribe failed'));
    this.heartbeat = setInterval(() => void this.register(), this.heartbeatMs);
    void this.register();
  }

  private get controlChannel(): string {
    return `${this.opts.prefix}control`;
  }

  private docChannel(fileId: string): string {
    return `${this.opts.prefix}doc:${fileId}`;
  }

  private get registryKey(): string {
    return `${this.opts.prefix}instances`;
  }

  private async register(): Promise<void> {
    try {
      await this.pub.hset(this.registryKey, this.instanceId, String(Date.now()));
    } catch {
      // logged by the error handler
    }
  }

  private dispatch(channel: string, raw: string): void {
    let msg: DocBusMessage | ControlMessage;
    try {
      msg = JSON.parse(raw) as DocBusMessage | ControlMessage;
    } catch {
      return;
    }
    if (msg.from === this.instanceId) return;
    if ('to' in msg && msg.to !== this.instanceId) return;
    if (channel === this.controlChannel) {
      for (const h of this.controlHandlers) h(msg as ControlMessage);
      return;
    }
    const fileId = channel.slice(this.docChannel('').length);
    this.docHandlers.get(fileId)?.(msg as DocBusMessage);
  }

  async subscribeDoc(fileId: string, handler: (m: DocBusMessage) => void): Promise<void> {
    this.docHandlers.set(fileId, handler);
    await this.sub.subscribe(this.docChannel(fileId));
  }

  async unsubscribeDoc(fileId: string): Promise<void> {
    this.docHandlers.delete(fileId);
    await this.sub.unsubscribe(this.docChannel(fileId)).catch(() => undefined);
  }

  publishDoc(fileId: string, m: DocBusMessage): void {
    this.pub.publish(this.docChannel(fileId), JSON.stringify(m)).catch((err: Error) => {
      this.log.warn({ err, fileId }, 'Redis publish failed');
    });
  }

  onControl(handler: (m: ControlMessage) => void): void {
    this.controlHandlers.push(handler);
  }

  publishControl(m: ControlMessage): void {
    this.pub.publish(this.controlChannel, JSON.stringify(m)).catch((err: Error) => {
      this.log.warn({ err }, 'Redis publish failed');
    });
  }

  async peers(): Promise<number> {
    const all = await this.pub.hgetall(this.registryKey);
    const alive = Date.now() - 3 * this.heartbeatMs;
    let n = 0;
    for (const [id, ts] of Object.entries(all)) {
      if (id === this.instanceId) continue;
      if (Number(ts) >= alive) n++;
      else void this.pub.hdel(this.registryKey, id).catch(() => undefined);
    }
    return n;
  }

  async ping(): Promise<void> {
    await this.pub.ping();
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    await this.pub.hdel(this.registryKey, this.instanceId).catch(() => undefined);
    this.sub.disconnect();
    await this.pub.quit().catch(() => this.pub.disconnect());
  }
}

export const toB64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
export const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
