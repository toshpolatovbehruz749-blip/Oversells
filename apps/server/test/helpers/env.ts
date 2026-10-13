import path from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: [path.resolve('.env'), path.resolve('../../.env')], quiet: true });

/**
 * Database used by the tests. It is wiped on every run, so it must never point
 * at real data. Defaults to the `oversells_test` database next to DATABASE_URL.
 */
export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL ?? 'postgresql://oversells:oversells@localhost:5432/oversells';
  const url = new URL(base);
  url.pathname = '/oversells_test';
  return url.toString();
}
