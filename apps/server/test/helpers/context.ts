import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { CSRF_COOKIE } from '../../src/auth/http.js';
import type { Mailer, MailMessage } from '../../src/auth/mailer.js';
import { buildApp, type BuiltApp } from '../../src/app.js';
import { loadConfig, type Config } from '../../src/config.js';
import type { CompileRunner } from '../../src/compile/runner.js';
import { testDatabaseUrl } from './env.js';

export interface TestContext extends BuiltApp {
  dataDir: string;
  config: Config;
  /** Logged-in client of the default test user (owner of the projects it creates). */
  api: TestClient;
  /** A new, anonymous client with its own cookie jar. */
  client(shareToken?: string): TestClient;
  mailer: CapturingMailer;
  close(): Promise<void>;
}

export const TEST_PASSWORD = 'maxfiy-parol-123';

/** Records e-mails instead of sending them. */
export class CapturingMailer implements Mailer {
  sent: MailMessage[] = [];
  async send(message: MailMessage) {
    this.sent.push(message);
  }
}

type InjectOpts = { method?: string; url: string; payload?: unknown; headers?: Record<string, string> };

/**
 * app.inject() with a cookie jar: keeps the session and CSRF cookies and
 * sends the X-CSRF-Token header, like the web client does. An optional share
 * token is sent as X-Share-Token.
 */
export class TestClient {
  readonly cookies = new Map<string, string>();

  constructor(
    private readonly app: FastifyInstance,
    public shareToken?: string,
  ) {}

  async inject(opts: InjectOpts | string): Promise<LightMyRequestResponse> {
    const o: InjectOpts = typeof opts === 'string' ? { url: opts } : opts;
    if (!this.cookies.has(CSRF_COOKIE)) await this.send({ url: '/api/auth/me' });
    return this.send(o);
  }

  private async send(o: InjectOpts): Promise<LightMyRequestResponse> {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (this.cookies.size) {
      headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    const csrf = this.cookies.get(CSRF_COOKIE);
    if (csrf && !('x-csrf-token' in headers)) headers['x-csrf-token'] = csrf;
    if (this.shareToken) headers['x-share-token'] = this.shareToken;
    const res = await this.app.inject({
      method: (o.method ?? 'GET') as 'GET',
      url: o.url,
      payload: o.payload as string | object | Buffer | undefined,
      headers,
    });
    for (const c of res.cookies as Array<{ name: string; value: string; expires?: Date }>) {
      if (!c.value || (c.expires && c.expires.getTime() < Date.now())) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    return res;
  }

  async register(email: string, password = TEST_PASSWORD, name?: string) {
    const res = await this.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password, name } });
    if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
    return res.json().user as { id: string; email: string; name: string };
  }

  async login(email: string, password = TEST_PASSWORD) {
    return this.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  }
}

let sharedPrisma: PrismaClient | null = null;

export function testPrisma(): PrismaClient {
  sharedPrisma ??= new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
  return sharedPrisma;
}

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "CompileJob", "ProjectFile", "ShareLink", "Project", "Session", "PasswordResetToken", "User" CASCADE',
  );
}

/** Builds the app against the test database, a temp data dir and the given runner. */
export async function createTestContext(
  runner: CompileRunner | undefined,
  env: Record<string, string> = {},
): Promise<TestContext> {
  const prisma = testPrisma();
  await resetDatabase(prisma);
  const dataDir = await mkdtemp(path.join(tmpdir(), 'oversells-test-'));
  const config = loadConfig({
    DATABASE_URL: testDatabaseUrl(),
    DATA_DIR: dataDir,
    LOG_LEVEL: 'silent',
    AUTH_RATE_LIMIT_MAX: '1000',
    ...env,
  });
  const mailer = new CapturingMailer();
  const built = await buildApp({ config, prisma, runner, mailer, logger: false });
  await built.app.ready();
  const api = new TestClient(built.app);
  await api.register('owner@test.uz', TEST_PASSWORD, 'Oʻqituvchi');
  return {
    ...built,
    dataDir,
    config,
    api,
    mailer,
    client: (shareToken?: string) => new TestClient(built.app, shareToken),
    async close() {
      await built.app.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** Builds a multipart/form-data body for app.inject(). */
export function multipart(files: Array<{ name: string; data: Buffer | string; field?: string }>) {
  const boundary = `----oversells${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const f of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.field ?? 'file'}"; filename="${f.name}"\r\n` +
          'Content-Type: application/octet-stream\r\n\r\n',
      ),
      Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8'),
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}
