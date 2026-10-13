import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { buildApp, type BuiltApp } from '../../src/app.js';
import { loadConfig, type Config } from '../../src/config.js';
import type { CompileRunner } from '../../src/compile/runner.js';
import { testDatabaseUrl } from './env.js';

export interface TestContext extends BuiltApp {
  dataDir: string;
  config: Config;
  close(): Promise<void>;
}

let sharedPrisma: PrismaClient | null = null;

export function testPrisma(): PrismaClient {
  sharedPrisma ??= new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
  return sharedPrisma;
}

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE "CompileJob", "ProjectFile", "Project" CASCADE');
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
    ...env,
  });
  const built = await buildApp({ config, prisma, runner, logger: false });
  await built.app.ready();
  return {
    ...built,
    dataDir,
    config,
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
